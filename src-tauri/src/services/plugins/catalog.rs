//! 插件与市场目录解析：CLI 表格输出、市场元数据富化、manifest 读取与 contains 推导。

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::Value;

use crate::codex::config::parse_document;
use crate::services::plugin_net::{parse_github_url, TreeEntry};

use super::store::store_contains;
use super::*;
/// 解析 `codex plugin list` 的表格输出：
/// `<插件>@<市场>  installed, enabled|disabled  <版本>  <路径>`；`not installed` 跳过。
pub(super) fn parse_plugin_list_output(
    text: &str,
) -> Vec<(String, String, bool, Option<String>, String)> {
    let mut items = Vec::new();
    for line in text.lines() {
        let line = line.trim_end();
        let trimmed = line.trim_start();
        if trimmed.is_empty()
            || trimmed.starts_with("PLUGIN ")
            || trimmed.starts_with("Marketplace `")
        {
            continue;
        }
        let Some((selector, rest)) = trimmed.split_once(char::is_whitespace) else {
            continue;
        };
        let Some((plugin, marketplace)) = selector.split_once('@') else {
            continue;
        };
        let rest = rest.trim_start();
        if rest.starts_with("not installed") {
            continue;
        }
        if !rest.starts_with("installed,") {
            continue;
        }
        let enabled = rest.starts_with("installed, enabled");
        let after_status = rest
            .strip_prefix("installed, enabled")
            .or_else(|| rest.strip_prefix("installed, disabled"))
            .unwrap_or(rest)
            .trim_start();
        let mut parts = after_status.split_whitespace();
        let version = parts
            .next()
            .filter(|token| !token.contains('\\') && !token.contains('/'));
        let path = parts.collect::<Vec<_>>().join(" ");
        items.push((
            plugin.to_string(),
            marketplace.to_string(),
            enabled,
            version.map(str::to_string),
            path,
        ));
    }
    items
}

pub(super) fn parse_marketplace_list_output(text: &str) -> Vec<PluginMarketplace> {
    text.lines()
        .filter_map(|line| {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with("MARKETPLACE") {
                return None;
            }
            let (name, root) = trimmed.split_once(char::is_whitespace)?;
            let name = name.trim();
            let root = root.trim();
            if name.is_empty() || root.is_empty() {
                return None;
            }
            Some(PluginMarketplace {
                name: name.to_string(),
                root: root.to_string(),
                kind: if name.starts_with("openai") {
                    "official".into()
                } else {
                    "third-party".into()
                },
                source_url: None,
                display_name: None,
                description: None,
            })
        })
        .collect()
}

pub(super) fn sort_marketplaces(items: &mut [PluginMarketplace]) {
    items.sort_by(|left, right| {
        (left.kind != "official")
            .cmp(&(right.kind != "official"))
            .then_with(|| left.name.cmp(&right.name))
    });
}

pub(super) fn marketplace_sources(home: &Path) -> BTreeMap<String, String> {
    let Ok(text) = std::fs::read_to_string(home.join(".codex/config.toml")) else {
        return BTreeMap::new();
    };
    let Ok(document) = parse_document(&text) else {
        return BTreeMap::new();
    };
    let Some(marketplaces) = document
        .as_table()
        .get("marketplaces")
        .and_then(|item| item.as_table())
    else {
        return BTreeMap::new();
    };
    marketplaces
        .iter()
        .filter_map(|(name, item)| {
            let source = item.as_table()?.get("source")?.as_str()?;
            (source.starts_with("http://")
                || source.starts_with("https://")
                || source.starts_with("ssh://")
                || source.starts_with("git@"))
            .then(|| (name.to_string(), source.to_string()))
        })
        .collect()
}

pub(super) fn enrich_plugin_sources(
    items: &mut [PluginSummary],
    sources: &BTreeMap<String, String>,
) {
    for item in items {
        item.source_url = item
            .marketplace
            .as_ref()
            .and_then(|name| sources.get(name).cloned());
    }
}

pub(super) fn read_marketplace_document(root: &Path) -> Option<Value> {
    [
        root.join(".agents/plugins/marketplace.json"),
        root.join(".claude-plugin/marketplace.json"),
        root.join("marketplace.json"),
    ]
    .into_iter()
    .find_map(|path| std::fs::read_to_string(path).ok())
    .and_then(|text| serde_json::from_str(&text).ok())
}

pub(super) fn marketplace_metadata(root: &Path) -> (Option<String>, Option<String>) {
    let document = read_marketplace_document(root);
    let interface = document.as_ref().and_then(|item| item.get("interface"));
    let display_name = interface
        .and_then(|item| item.get("displayName"))
        .and_then(Value::as_str)
        .map(String::from);
    let description = document
        .as_ref()
        .and_then(|item| item.get("metadata"))
        .and_then(|item| item.get("description"))
        .and_then(Value::as_str)
        .or_else(|| {
            interface
                .and_then(|item| item.get("longDescription"))
                .and_then(Value::as_str)
        })
        .or_else(|| {
            interface
                .and_then(|item| item.get("shortDescription"))
                .and_then(Value::as_str)
        })
        .map(String::from)
        .or_else(|| read_manifest(root).as_ref().and_then(manifest_description));
    (display_name, description)
}

pub(super) fn enrich_marketplace_metadata(
    items: &mut [PluginMarketplace],
    sources: &BTreeMap<String, String>,
) {
    for item in items {
        let (display_name, description) = marketplace_metadata(Path::new(&item.root));
        item.source_url = sources.get(&item.name).cloned();
        item.display_name = display_name;
        item.description = description;
    }
}

#[derive(Default)]
pub(super) struct MarketplaceEntryMetadata {
    display_name: Option<String>,
    description: Option<String>,
    category: Option<String>,
    capabilities: Vec<String>,
    contains: Vec<String>,
    version: Option<String>,
}

pub(super) fn marketplace_entry_metadata(
    root: Option<&Path>,
    name: &str,
) -> MarketplaceEntryMetadata {
    let Some(root) = root else {
        return MarketplaceEntryMetadata::default();
    };
    let Some(document) = read_marketplace_document(root) else {
        return MarketplaceEntryMetadata::default();
    };
    let Some(entry) = document
        .get("plugins")
        .and_then(Value::as_array)
        .and_then(|items| {
            items
                .iter()
                .find(|item| item.get("name").and_then(Value::as_str) == Some(name))
        })
    else {
        return MarketplaceEntryMetadata::default();
    };
    let interface = entry.get("interface");
    let local_path = entry_local_path(entry).and_then(|raw| resolve_local_path(root, &raw));
    let local_manifest = local_path.as_deref().and_then(read_manifest);
    let manifest_interface = local_manifest
        .as_ref()
        .and_then(|item| item.interface.as_ref());
    MarketplaceEntryMetadata {
        display_name: interface
            .and_then(|item| item.get("displayName"))
            .and_then(Value::as_str)
            .map(String::from)
            .or_else(|| manifest_interface.and_then(|item| item.display_name.clone())),
        description: entry
            .get("description")
            .and_then(Value::as_str)
            .map(String::from)
            .or_else(|| local_manifest.as_ref().and_then(manifest_description)),
        category: entry
            .get("category")
            .and_then(Value::as_str)
            .map(String::from)
            .or_else(|| manifest_interface.and_then(|item| item.category.clone())),
        capabilities: manifest_interface
            .map(|item| item.capabilities.clone())
            .unwrap_or_default(),
        contains: local_path
            .as_deref()
            .map(store_contains)
            .unwrap_or_default(),
        version: local_manifest
            .as_ref()
            .and_then(|item| item.version.clone()),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PluginCatalogEntry {
    plugin_id: String,
    name: String,
    marketplace_name: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    installed: bool,
    #[serde(default)]
    auth_policy: String,
    #[serde(default)]
    source: Option<Value>,
}

#[derive(Debug, Deserialize)]
pub(super) struct PluginCatalogOutput {
    #[serde(default)]
    installed: Vec<PluginCatalogEntry>,
    #[serde(default)]
    available: Vec<PluginCatalogEntry>,
}

pub(super) fn plugin_source_label(source: Option<&Value>) -> Option<String> {
    let object = source?.as_object()?;
    ["url", "repo", "path"]
        .iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str).map(String::from))
}

pub(super) fn parse_marketplace_plugins_output(
    text: &str,
    marketplace: &str,
    root: Option<&Path>,
) -> AppResult<Vec<MarketplacePlugin>> {
    let output: PluginCatalogOutput = serde_json::from_str(text)
        .map_err(|error| app_err!("codex plugin list JSON 无效: {error}"))?;
    let mut seen = Vec::new();
    Ok(output
        .installed
        .into_iter()
        .chain(output.available)
        .filter(|item| item.marketplace_name == marketplace)
        .filter_map(|item| {
            if seen.iter().any(|id| id == &item.plugin_id) {
                return None;
            }
            seen.push(item.plugin_id.clone());
            let metadata = marketplace_entry_metadata(root, &item.name);
            Some(MarketplacePlugin {
                plugin_id: item.plugin_id,
                name: item.name,
                version: item.version.or(metadata.version),
                installed: item.installed,
                auth_policy: item.auth_policy,
                source: plugin_source_label(item.source.as_ref()),
                display_name: metadata.display_name,
                description: metadata.description,
                category: metadata.category,
                capabilities: metadata.capabilities,
                contains: metadata.contains,
            })
        })
        .collect())
}

/// 解析 `codex plugin list` 输出的市场身份集合（"Marketplace `X`" 头部行）。
pub(super) fn parse_marketplace_identities(text: &str) -> Vec<String> {
    text.lines()
        .filter_map(|line| line.trim().strip_prefix("Marketplace `"))
        .filter_map(|rest| {
            rest.strip_suffix('`')
                .filter(|name| !name.is_empty())
                .map(str::to_string)
        })
        .collect()
}

/// 安装目标市场：镜像存在 `-remote` 原体时优先远程身份（桌面端注册表口径），否则原样。
pub(super) fn resolve_install_marketplace(marketplace: &str, identities: &[String]) -> String {
    let remote = format!("{marketplace}-remote");
    if identities.contains(&remote) {
        remote
    } else {
        marketplace.to_string()
    }
}

pub(super) fn find_plugin_updates(
    installed: &[PluginSummary],
    available: &[MarketplacePlugin],
) -> Vec<PluginUpdate> {
    available
        .iter()
        .filter(|plugin| plugin.installed)
        .filter_map(|plugin| {
            let (name, marketplace) = plugin.plugin_id.rsplit_once('@')?;
            let version = plugin.version.as_deref()?;
            installed
                .iter()
                .find(|item| {
                    item.origin == "codex"
                        && item.name == name
                        && item.marketplace.as_deref() == Some(marketplace)
                })
                .filter(|item| item.version.as_deref() != Some(version))
                .map(|_| PluginUpdate {
                    name: name.to_string(),
                    marketplace: marketplace.to_string(),
                    version: version.to_string(),
                })
        })
        .collect()
}

/// 从 `marketplace add` 的输出里解析市场名（如 “Marketplace `ponytail`”），失败回退仓库名。
pub(super) fn parse_marketplace_name(output: &str, fallback: &str) -> String {
    if let Some(start) = output.find('`') {
        if let Some(length) = output[start + 1..].find('`') {
            let name = &output[start + 1..start + 1 + length];
            if !name.is_empty() {
                return name.to_string();
            }
        }
    }
    fallback.to_string()
}

/// Codex 官方支持的 marketplace add 来源：GitHub 简写、Git URL、SSH URL 或本地目录。
pub(super) fn parse_marketplace_source(input: &str) -> AppResult<(String, String)> {
    let text = input.trim();
    if text.is_empty() || text.starts_with('-') {
        return Err(app_err!("插件市场地址不能为空，且不能以 - 开头"));
    }
    if let Ok(source) = parse_github_url(text) {
        let argument = match source.ref_name {
            Some(reference) => format!("{}/{}@{reference}", source.owner, source.repo),
            None => format!("{}/{}", source.owner, source.repo),
        };
        return Ok((argument, source.repo));
    }
    let accepted = text.starts_with("http://")
        || text.starts_with("https://")
        || text.starts_with("ssh://")
        || text.starts_with("git@")
        || Path::new(text).is_absolute()
        || text.starts_with("./")
        || text.starts_with("../");
    if !accepted {
        return Err(app_err!(
            "无法识别插件市场来源，请使用 owner/repo、Git URL、SSH URL 或本地目录"
        ));
    }
    let last = text
        .trim_matches(['/', '\\'])
        .rsplit(['/', '\\', ':'])
        .find(|part| !part.is_empty())
        .unwrap_or("third-party-marketplace");
    let fallback = last.strip_suffix(".git").unwrap_or(last).to_string();
    Ok((text.to_string(), fallback))
}

/// 市场条目的 local 源路径（兼容两种写法）。
pub(super) fn entry_local_path(entry: &Value) -> Option<String> {
    match entry.get("source")? {
        Value::String(path) => Some(path.clone()),
        Value::Object(object) => {
            if object.get("source").and_then(Value::as_str) == Some("local") {
                object.get("path")?.as_str().map(String::from)
            } else {
                None
            }
        }
        _ => None,
    }
}

/// local 路径相对 marketplace 根（= 用户主目录）解析；拒绝绝对路径与 `..` 穿越。
/// `.cursor-plugin` 布局允许无 `./` 前缀（与 Codex 行为一致）。
pub(super) fn resolve_local_path(home: &Path, raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    let relative = trimmed.strip_prefix("./").unwrap_or(trimmed);
    let relative_path = Path::new(relative);
    if !relative_path.is_relative() {
        return None;
    }
    let mut full = home.to_path_buf();
    for component in relative_path.components() {
        match component {
            std::path::Component::Normal(part) => full.push(part),
            _ => return None,
        }
    }
    Some(full)
}

// ==================== 共享工具 ====================

pub(super) fn parse_manifest_text(text: &str) -> AppResult<PluginManifest> {
    serde_json::from_str(text).map_err(|error| app_err!("plugin.json 不是有效 JSON: {error}"))
}

pub(super) fn manifest_description(manifest: &PluginManifest) -> Option<String> {
    manifest
        .description
        .clone()
        .or_else(|| manifest.interface.as_ref()?.long_description.clone())
        .or_else(|| manifest.interface.as_ref()?.short_description.clone())
}

pub(super) fn read_manifest(plugin_root: &Path) -> Option<PluginManifest> {
    let text = std::fs::read_to_string(plugin_root.join(MANIFEST_RELATIVE_PATH))
        .or_else(|_| std::fs::read_to_string(plugin_root.join(CLAUDE_MANIFEST_RELATIVE_PATH)))
        .ok()?;
    parse_manifest_text(&text).ok()
}

/// 插件名做选择器/目录名：拒绝路径分隔与目录穿越，其余保留官方命名。
pub(super) fn validate_plugin_name(name: &str) -> AppResult<()> {
    let valid = !name.is_empty()
        && name.len() <= 80
        && !name.contains(['/', '\\', ':', '@'])
        && name != "."
        && name != "..";
    if valid {
        Ok(())
    } else {
        Err(app_err!("插件名「{name}」包含非法字符"))
    }
}

/// 从文件树里找插件根目录（.codex-plugin/plugin.json 的父目录），仓库根插件表示为空串。
pub(super) fn plugin_roots(entries: &[TreeEntry]) -> Vec<String> {
    let mut roots: Vec<String> = entries
        .iter()
        .filter(|entry| entry.kind == "blob" && entry.path.ends_with(MANIFEST_RELATIVE_PATH))
        .map(|entry| {
            entry
                .path
                .strip_suffix(&format!("/{MANIFEST_RELATIVE_PATH}"))
                .unwrap_or_default()
                .to_string()
        })
        .collect();
    roots.sort();
    roots.dedup();
    roots
}

/// 判断 root 是否等于指定子路径或位于其下（子目录过滤用）。
pub(super) fn root_within(root: &str, sub_path: &str) -> bool {
    let sub = sub_path.trim_matches('/');
    if sub.is_empty() {
        return true;
    }
    root == sub || root.starts_with(&format!("{sub}/"))
}

pub(super) fn files_under_root<'a>(entries: &'a [TreeEntry], root: &str) -> Vec<&'a str> {
    entries
        .iter()
        .filter(|entry| entry.kind == "blob" && root_within(&entry.path, root))
        .map(|entry| entry.path.as_str())
        .collect()
}

/// 从插件文件清单推导内容类型（白皮书的「包含内容」维度）。
pub(super) fn derive_contains(files: &[&str]) -> Vec<String> {
    let mut contains = Vec::new();
    let has = |predicate: &dyn Fn(&str) -> bool| files.iter().any(|path| predicate(path));
    if has(&|path| path.starts_with("skills/") || path == "skills") {
        contains.push("skills".into());
    }
    if has(&|path| path.ends_with("/.mcp.json") || path == ".mcp.json") {
        contains.push("mcp".into());
    }
    if has(&|path| path.ends_with("/.app.json") || path == ".app.json") {
        contains.push("app".into());
    }
    if has(&|path| path.ends_with("/hooks.json") || path == "hooks.json") {
        contains.push("hooks".into());
    }
    if has(&|path| path.starts_with("agents/")) {
        contains.push("agents".into());
    }
    if has(&|path| path.starts_with("commands/")) {
        contains.push("commands".into());
    }
    contains
}
