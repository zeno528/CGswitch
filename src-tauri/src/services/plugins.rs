//! 插件市场服务：GitHub 插件的发现、安装与本地生命周期。
//!
//! 安装模型（以实测的 Codex CLI 0.149 为准）：
//! - 安装 = `codex plugin marketplace add <git 源>` + `codex plugin add <插件@市场>`；
//!   卸载 = `codex plugin remove <插件@市场>`——官方路径，状态由 Codex 自己维护；
//! - 预览走 CGswitch 自己的 GitHub 拉取（清单、文件列表、内容类型，不落盘）；
//! - 列表以 `codex plugin list` 为主源（覆盖官方运行时/捆绑/外部市场，含启停状态），
//!   CLI 不在时回退扫 `~/.codex/plugins/cache/`；Skill 注册表 `~/.agents/.skill-lock.json`
//!   与家目录四套 marketplace 布局的 local 条目也在列；
//! - origin 语义：cgswitch=本应用经 CLI 安装；codex=用户自装的外部市场插件（可卸载）；
//!   official=openai 运行时/捆绑市场（只读）；skill=Skill 注册表（只读）；
//!   personal/claude/cursor=家目录 local 条目（可禁用/移除，条目暂存可恢复）。

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::UNIX_EPOCH;

use serde::{Deserialize, Serialize};
use serde_json::Value;

#[cfg(test)]
use serde_json::json;

use crate::codex::config::parse_document;

use super::plugin_net::{
    fetch_raw_file, fetch_repo_tree, parse_github_url, preview_file_limit, TreeEntry,
};
use super::{app_err, now_ms, AppContext, AppResult};

/// 前端展示用的已安装插件摘要。
#[derive(Debug, Clone, Serialize, Default)]
pub struct PluginSummary {
    pub name: String,
    pub version: Option<String>,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub capabilities: Vec<String>,
    pub contains: Vec<String>,
    pub enabled: bool,
    /// official=OpenAI 官方市场（只读）；codex=Codex 管理的外部市场。
    pub origin: String,
    /// 来自 `codex plugin list` 的市场名（卸载选择器要用）。
    pub marketplace: Option<String>,
    pub store_path: String,
    pub source_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct PluginSkill {
    pub name: String,
    pub path: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct PluginMarketplace {
    pub name: String,
    pub root: String,
    pub kind: String,
    pub source_url: Option<String>,
    pub display_name: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct MarketplacePlugin {
    pub plugin_id: String,
    pub name: String,
    pub version: Option<String>,
    pub installed: bool,
    pub auth_policy: String,
    pub source: Option<String>,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub category: Option<String>,
    pub capabilities: Vec<String>,
}

/// 外部市场快照更新后，已安装插件的可升级项。
#[derive(Debug, Clone, Serialize, Default)]
pub struct PluginUpdate {
    pub name: String,
    pub marketplace: String,
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct SkillSummary {
    pub name: String,
    pub description: Option<String>,
    pub source_url: Option<String>,
    pub store_path: String,
    pub source_path: Option<String>,
    pub update_available: bool,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct SkillCandidate {
    pub name: String,
    pub description: Option<String>,
    pub store_path: String,
    pub source: String,
    pub has_content_conflict: bool,
    pub is_update: bool,
    pub modified_at: u64,
}

/// 预览阶段的候选插件（一个仓库可能包含多个插件根目录）。
#[derive(Debug, Clone, Serialize)]
pub struct PluginCandidate {
    pub sub_path: String,
    pub name: String,
    pub version: Option<String>,
    pub display_name: Option<String>,
    pub description: Option<String>,
    pub capabilities: Vec<String>,
    pub contains: Vec<String>,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PluginPreview {
    pub repo: String,
    pub reference: String,
    pub default_branch: String,
    pub candidates: Vec<PluginCandidate>,
}

/// plugin.json 的解析子集（官方字段很多，这里只取列表与详情需要的）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginManifest {
    name: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    interface: Option<PluginInterface>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginInterface {
    #[serde(default)]
    display_name: Option<String>,
    #[serde(default)]
    short_description: Option<String>,
    #[serde(default)]
    long_description: Option<String>,
    #[serde(default)]
    category: Option<String>,
    #[serde(default)]
    capabilities: Vec<String>,
}

const MANIFEST_RELATIVE_PATH: &str = ".codex-plugin/plugin.json";
/// Claude 布局的清单回退路径（多 Agent 插件两种都有，如 ponytail）。
const CLAUDE_MANIFEST_RELATIVE_PATH: &str = ".claude-plugin/plugin.json";
const SKILL_SOURCE_FILE: &str = ".sources.json";
const SKILL_BACKUP_DIRECTORY: &str = ".backups";
/// Codex marketplace 插件的物化缓存（相对 codex home，CLI 缺席时的回退数据源）。
const PLUGIN_CACHE_RELATIVE_PATH: &str = "plugins/cache";

impl PluginSummary {
    fn from_parts(
        name: &str,
        manifest: Option<&PluginManifest>,
        contains: Vec<String>,
        origin: &str,
        store_path: &Path,
    ) -> Self {
        let interface = manifest.and_then(|item| item.interface.as_ref());
        Self {
            name: manifest
                .map(|item| item.name.clone())
                .unwrap_or_else(|| name.to_string()),
            version: manifest.and_then(|item| item.version.clone()),
            display_name: interface.and_then(|item| item.display_name.clone()),
            description: manifest.and_then(manifest_description),
            category: interface.and_then(|item| item.category.clone()),
            capabilities: interface
                .map(|item| item.capabilities.clone())
                .unwrap_or_default(),
            contains,
            enabled: false,
            origin: origin.to_string(),
            marketplace: None,
            store_path: store_path.display().to_string(),
            source_url: None,
        }
    }
}

// ==================== codex CLI 执行层 ====================

fn codex_cli_file_name() -> &'static str {
    if cfg!(windows) {
        "codex.exe"
    } else {
        "codex"
    }
}

/// codex CLI 探测链：`~/.codex/bin`（CLI 安装约定）、Desktop appserver 自带的副本、PATH。
fn find_codex_cli(home: &Path) -> Option<PathBuf> {
    let mut candidates = vec![
        home.join(".codex").join("bin").join(codex_cli_file_name()),
        home.join(".codex")
            .join("plugins")
            .join(".plugin-appserver")
            .join(codex_cli_file_name()),
    ];
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            candidates.push(dir.join(codex_cli_file_name()));
        }
    }
    candidates.into_iter().find(|path| path.is_file())
}

/// 跑 `codex plugin <args>`，返回 stdout；失败时把 CLI 的报错带出来。
fn run_codex_plugin(home: &Path, args: &[&str]) -> AppResult<String> {
    let cli = find_codex_cli(home).ok_or_else(|| {
        app_err!(
            "未找到 codex CLI（已尝试 ~/.codex/bin、桌面版 appserver 目录与 PATH），无法管理插件"
        )
    })?;
    let mut command = std::process::Command::new(&cli);
    command.arg("plugin").args(args);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command
        .output()
        .map_err(|error| app_err!("执行 codex CLI 失败: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    if !output.status.success() {
        let detail = if stderr.trim().is_empty() {
            stdout.trim()
        } else {
            stderr.trim()
        };
        return Err(app_err!("codex CLI 报错：{detail}"));
    }
    Ok(stdout)
}

/// 解析 `codex plugin list` 的表格输出：
/// `<插件>@<市场>  installed, enabled|disabled  <版本>  <路径>`；`not installed` 跳过。
fn parse_plugin_list_output(text: &str) -> Vec<(String, String, bool, Option<String>, String)> {
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

fn parse_marketplace_list_output(text: &str) -> Vec<PluginMarketplace> {
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

fn sort_marketplaces(items: &mut [PluginMarketplace]) {
    items.sort_by(|left, right| {
        (left.kind != "official")
            .cmp(&(right.kind != "official"))
            .then_with(|| left.name.cmp(&right.name))
    });
}

fn marketplace_sources(home: &Path) -> BTreeMap<String, String> {
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

fn enrich_plugin_sources(items: &mut [PluginSummary], sources: &BTreeMap<String, String>) {
    for item in items {
        item.source_url = item
            .marketplace
            .as_ref()
            .and_then(|name| sources.get(name).cloned());
    }
}

fn read_marketplace_document(root: &Path) -> Option<Value> {
    [
        root.join(".agents/plugins/marketplace.json"),
        root.join(".claude-plugin/marketplace.json"),
        root.join("marketplace.json"),
    ]
    .into_iter()
    .find_map(|path| std::fs::read_to_string(path).ok())
    .and_then(|text| serde_json::from_str(&text).ok())
}

fn marketplace_metadata(root: &Path) -> (Option<String>, Option<String>) {
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

fn enrich_marketplace_metadata(
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
struct MarketplaceEntryMetadata {
    display_name: Option<String>,
    description: Option<String>,
    category: Option<String>,
    capabilities: Vec<String>,
    version: Option<String>,
}

fn marketplace_entry_metadata(root: Option<&Path>, name: &str) -> MarketplaceEntryMetadata {
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
    let local_manifest = entry_local_path(entry)
        .and_then(|raw| resolve_local_path(root, &raw))
        .and_then(|path| read_manifest(&path));
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
        version: local_manifest
            .as_ref()
            .and_then(|item| item.version.clone()),
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PluginCatalogEntry {
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
struct PluginCatalogOutput {
    #[serde(default)]
    installed: Vec<PluginCatalogEntry>,
    #[serde(default)]
    available: Vec<PluginCatalogEntry>,
}

fn plugin_source_label(source: Option<&Value>) -> Option<String> {
    let object = source?.as_object()?;
    ["url", "repo", "path"]
        .iter()
        .find_map(|key| object.get(*key).and_then(Value::as_str).map(String::from))
}

fn parse_marketplace_plugins_output(
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
            })
        })
        .collect())
}

fn find_plugin_updates(
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
fn parse_marketplace_name(output: &str, fallback: &str) -> String {
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
fn parse_marketplace_source(input: &str) -> AppResult<(String, String)> {
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
fn entry_local_path(entry: &Value) -> Option<String> {
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
fn resolve_local_path(home: &Path, raw: &str) -> Option<PathBuf> {
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

fn parse_manifest_text(text: &str) -> AppResult<PluginManifest> {
    serde_json::from_str(text).map_err(|error| app_err!("plugin.json 不是有效 JSON: {error}"))
}

fn manifest_description(manifest: &PluginManifest) -> Option<String> {
    manifest
        .description
        .clone()
        .or_else(|| manifest.interface.as_ref()?.long_description.clone())
        .or_else(|| manifest.interface.as_ref()?.short_description.clone())
}

fn read_manifest(plugin_root: &Path) -> Option<PluginManifest> {
    let text = std::fs::read_to_string(plugin_root.join(MANIFEST_RELATIVE_PATH))
        .or_else(|_| std::fs::read_to_string(plugin_root.join(CLAUDE_MANIFEST_RELATIVE_PATH)))
        .ok()?;
    parse_manifest_text(&text).ok()
}

/// 插件名做选择器/目录名：拒绝路径分隔与目录穿越，其余保留官方命名。
fn validate_plugin_name(name: &str) -> AppResult<()> {
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
fn plugin_roots(entries: &[TreeEntry]) -> Vec<String> {
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
fn root_within(root: &str, sub_path: &str) -> bool {
    let sub = sub_path.trim_matches('/');
    if sub.is_empty() {
        return true;
    }
    root == sub || root.starts_with(&format!("{sub}/"))
}

fn files_under_root<'a>(entries: &'a [TreeEntry], root: &str) -> Vec<&'a str> {
    entries
        .iter()
        .filter(|entry| entry.kind == "blob" && root_within(&entry.path, root))
        .map(|entry| entry.path.as_str())
        .collect()
}

/// 从插件文件清单推导内容类型（白皮书的「包含内容」维度）。
fn derive_contains(files: &[&str]) -> Vec<String> {
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

fn store_contains(plugin_dir: &Path) -> Vec<String> {
    let files = walk_files(plugin_dir);
    let relative: Vec<&str> = files.iter().map(|path| path.as_str()).collect();
    derive_contains(&relative)
}

/// 读取插件内的 Skill 清单；Codex 插件约定为 `skills/<name>/SKILL.md`。
fn store_skills(plugin_dir: &Path) -> Vec<PluginSkill> {
    walk_files(plugin_dir)
        .into_iter()
        .filter_map(|path| {
            let name = if path == "SKILL.md" {
                plugin_dir
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or("SKILL")
                    .to_string()
            } else {
                let skill_path = path.strip_prefix("skills/")?;
                let name = skill_path.strip_suffix("/SKILL.md")?;
                if name.is_empty() {
                    return None;
                }
                name.to_string()
            };
            let description = read_skill_description(&plugin_dir.join(&path));
            Some(PluginSkill {
                name,
                path,
                description,
            })
        })
        .collect()
}

// ponytail: 只读 SKILL.md frontmatter 的单行 description；多行 YAML 描述暂不展开。
fn read_skill_description(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let mut frontmatter = false;
    for (index, line) in text.lines().enumerate().take(40) {
        let trimmed = line.trim();
        if index == 0 && trimmed == "---" {
            frontmatter = true;
            continue;
        }
        if frontmatter && trimmed == "---" {
            break;
        }
        if frontmatter {
            let Some(value) = trimmed.strip_prefix("description:") else {
                continue;
            };
            let value = value.trim().trim_matches(['"', '\'']);
            if !value.is_empty() && value != "|" && value != ">" {
                return Some(value.to_string());
            }
        }
    }
    None
}

/// 列出插件目录内全部文件的目录内相对路径（插件体量小，直接递归）。
fn walk_files(root: &Path) -> Vec<String> {
    fn visit(base: &Path, dir: &Path, out: &mut Vec<String>) {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                visit(base, &path, out);
            } else if let Ok(relative) = path.strip_prefix(base) {
                out.push(relative.to_string_lossy().replace('\\', "/"));
            }
        }
    }
    let mut files = Vec::new();
    visit(root, root, &mut files);
    files
}

/// 读取 `~/.agents/.skill-lock.json`（Codex 的 Skill 安装注册表，实测布局）。
fn read_managed_skills(repository: &Path, home: &Path) -> Vec<SkillSummary> {
    let sources = read_skill_sources(repository);
    let mut skills = Vec::new();
    if let Ok(entries) = fs::read_dir(repository) {
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.join("SKILL.md").is_file() {
                let source_path = sources.get(&name).cloned();
                let enabled = home.join(".codex/skills").join(&name).is_dir();
                skills.push(SkillSummary {
                    name,
                    description: read_skill_description(&path.join("SKILL.md")),
                    source_url: None,
                    store_path: path.display().to_string(),
                    update_available: source_path
                        .as_ref()
                        .map(|source| {
                            Path::new(source).is_dir()
                                && !directories_equal(Path::new(source), &path)
                        })
                        .unwrap_or(false),
                    source_path,
                    enabled,
                });
            }
        }
    }
    skills.sort_by(|left, right| left.name.cmp(&right.name));
    skills
}

fn skill_repository(root: &Path) -> PathBuf {
    root.join("skills")
}

fn same_skill_path(left: &Path, right: &Path) -> bool {
    fs::canonicalize(left).ok() == fs::canonicalize(right).ok()
}

fn is_registered_skill(home: &Path, name: &str) -> bool {
    fs::read_to_string(home.join(".agents/.skill-lock.json"))
        .ok()
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
        .and_then(|lock| lock.get("skills").and_then(Value::as_object).cloned())
        .is_some_and(|skills| skills.contains_key(name))
}

fn skill_io<T>(result: std::io::Result<T>) -> AppResult<T> {
    result.map_err(|error| app_err!("Skill 文件操作失败: {error}"))
}

fn read_skill_sources(repository: &Path) -> BTreeMap<String, String> {
    fs::read_to_string(repository.join(SKILL_SOURCE_FILE))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn write_skill_sources(repository: &Path, sources: &BTreeMap<String, String>) -> AppResult<()> {
    let path = repository.join(SKILL_SOURCE_FILE);
    let text = serde_json::to_string_pretty(sources)
        .map_err(|error| app_err!("Skill 来源记录序列化失败: {error}"))?;
    skill_io(fs::create_dir_all(
        path.parent().expect("Skill 来源文件有父目录"),
    ))?;
    skill_io(fs::write(path, text))?;
    Ok(())
}

fn copy_skill(source: &Path, target: &Path) -> AppResult<()> {
    if !source.join("SKILL.md").is_file() {
        return Err(app_err!("所选目录不是 Skill：缺少 SKILL.md"));
    }
    copy_skill_directory(source, target)
}

fn copy_skill_directory(source: &Path, target: &Path) -> AppResult<()> {
    skill_io(fs::create_dir_all(target))?;
    for entry in skill_io(fs::read_dir(source))? {
        let entry = skill_io(entry)?;
        let destination = target.join(entry.file_name());
        if entry.path().is_dir() {
            copy_skill_directory(&entry.path(), &destination)?;
        } else {
            skill_io(fs::copy(entry.path(), destination))?;
        }
    }
    Ok(())
}

fn directories_equal(left: &Path, right: &Path) -> bool {
    if !left.is_dir() || !right.is_dir() {
        return false;
    }
    let mut left_files = walk_files(left);
    let mut right_files = walk_files(right);
    left_files.sort();
    right_files.sort();
    if left_files.len() != right_files.len() {
        return false;
    }
    left_files
        .into_iter()
        .all(|relative| fs::read(left.join(&relative)).ok() == fs::read(right.join(&relative)).ok())
}

fn skill_modified_at(path: &Path) -> u64 {
    fs::metadata(path.join("SKILL.md"))
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or_default()
}

fn backup_skill(repository: &Path, name: &str) -> AppResult<Option<PathBuf>> {
    let source = repository.join(name);
    if !source.is_dir() {
        return Ok(None);
    }
    let destination = repository
        .join(SKILL_BACKUP_DIRECTORY)
        .join(name)
        .join(now_ms().to_string());
    copy_skill_directory(&source, &destination)?;
    Ok(Some(destination))
}

fn distribute_skill(home: &Path, repository: &Path, name: &str) -> AppResult<()> {
    replace_skill(
        &repository.join(name),
        &home.join(".codex/skills").join(name),
    )
}

fn replace_skill(source: &Path, target: &Path) -> AppResult<()> {
    let staged = target.with_extension(format!("cgswitch-{}", now_ms()));
    if staged.exists() {
        skill_io(fs::remove_dir_all(&staged))?;
    }
    copy_skill(source, &staged)?;
    if !directories_equal(source, &staged) {
        let _ = fs::remove_dir_all(&staged);
        return Err(app_err!("Skill 文件校验失败"));
    }
    if target.exists() {
        skill_io(fs::remove_dir_all(target))?;
    }
    skill_io(fs::rename(staged, target))?;
    Ok(())
}

/// CLI 缺席时的回退：扫 `~/.codex/plugins/cache/<marketplace>/<plugin>/<version>/`。
fn scan_codex_plugin_cache(codex_home: &Path) -> Vec<PluginSummary> {
    let cache_root = codex_home.join(PLUGIN_CACHE_RELATIVE_PATH);
    let Ok(marketplaces) = std::fs::read_dir(&cache_root) else {
        return Vec::new();
    };
    let mut summaries = Vec::new();
    for marketplace in marketplaces.flatten() {
        let marketplace_name = marketplace.file_name().to_string_lossy().to_string();
        let Ok(plugins) = std::fs::read_dir(marketplace.path()) else {
            continue;
        };
        for plugin in plugins.flatten() {
            let Ok(versions) = std::fs::read_dir(plugin.path()) else {
                continue;
            };
            let Some((version_dir_name, version_dir)) = versions
                .flatten()
                .filter(|entry| entry.path().is_dir())
                .map(|entry| {
                    (
                        entry.file_name().to_string_lossy().to_string(),
                        entry.path(),
                    )
                })
                .max_by(|(left, _), (right, _)| left.cmp(right))
            else {
                continue;
            };
            let manifest = read_manifest(&version_dir);
            let plugin_dir_name = plugin.file_name().to_string_lossy().to_string();
            let mut summary = PluginSummary::from_parts(
                &plugin_dir_name,
                manifest.as_ref(),
                store_contains(&version_dir),
                "codex",
                &version_dir,
            );
            summary.version = Some(version_dir_name).or(summary.version);
            summary.marketplace = Some(marketplace_name.clone());
            summary.enabled = true;
            summaries.push(summary);
        }
    }
    summaries
}

/// Codex 有时在列表中返回 Git 源而非已物化的插件目录；此时读取实际缓存。
fn plugin_store_path(
    codex_home: &Path,
    marketplace: &str,
    name: &str,
    version: Option<&str>,
    reported_path: &str,
) -> PathBuf {
    let reported = Path::new(reported_path);
    if reported.is_dir() {
        return reported.to_path_buf();
    }
    let cache_root = codex_home
        .join(PLUGIN_CACHE_RELATIVE_PATH)
        .join(marketplace)
        .join(name);
    if let Some(version) = version {
        let version_dir = cache_root.join(version);
        if version_dir.is_dir() {
            return version_dir;
        }
    }
    std::fs::read_dir(&cache_root)
        .ok()
        .and_then(|entries| {
            entries
                .flatten()
                .filter(|entry| entry.path().is_dir())
                .max_by_key(|entry| entry.file_name())
        })
        .map(|entry| entry.path())
        .unwrap_or(cache_root)
}

fn trusted_plugin_store_path(
    home: &Path,
    codex_home: &Path,
    name: &str,
    raw_path: &str,
) -> Option<PathBuf> {
    let path = fs::canonicalize(raw_path).ok()?;
    let roots = [
        codex_home.join("plugins"),
        home.join(".cache/codex-runtimes/plugins"),
        home.join(".cache/codex/plugins"),
    ];
    if !roots.iter().any(|root| {
        fs::canonicalize(root)
            .map(|root| path.starts_with(root))
            .unwrap_or(false)
    }) {
        return None;
    }
    (read_manifest(&path)
        .as_ref()
        .is_some_and(|manifest| manifest.name == name))
    .then_some(path)
}

// ==================== AppContext 服务 ====================

impl AppContext {
    /// 已安装插件列表：`codex plugin list`（主源，含启停）→ 插件缓存（CLI 缺席回退）。
    pub async fn list_plugins(&self) -> AppResult<Vec<PluginSummary>> {
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Ok(Vec::new());
        };
        let codex_home = self.paths.codex_home.clone();
        let summaries =
            tauri::async_runtime::spawn_blocking(move || list_plugins_sync(&home, &codex_home))
                .await
                .map_err(|error| app_err!("插件列表任务失败: {error}"))??;
        Ok(summaries)
    }

    /// Codex Skill 注册表中的独立 Skill 列表。
    pub async fn list_skills(&self) -> AppResult<Vec<SkillSummary>> {
        let repository = skill_repository(&self.paths.root);
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Ok(Vec::new());
        };
        tauri::async_runtime::spawn_blocking(move || read_managed_skills(&repository, &home))
            .await
            .map_err(|error| app_err!("Skill 列表任务失败: {error}"))
    }

    pub async fn get_skill_content(&self, name: &str) -> AppResult<String> {
        validate_plugin_name(name)?;
        let path = skill_repository(&self.paths.root)
            .join(name)
            .join("SKILL.md");
        tauri::async_runtime::spawn_blocking(move || skill_io(fs::read_to_string(path)))
            .await
            .map_err(|error| app_err!("Skill 内容读取任务失败: {error}"))?
    }

    pub async fn get_import_skill_content(&self, source_path: &str) -> AppResult<String> {
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        let source = PathBuf::from(source_path);
        tauri::async_runtime::spawn_blocking(move || {
            let source = skill_io(fs::canonicalize(source))?;
            let allowed = [home.join(".agents/skills"), home.join(".codex/skills")]
                .into_iter()
                .filter_map(|root| fs::canonicalize(root).ok())
                .any(|root| source.parent() == Some(root.as_path()));
            if !allowed {
                return Err(app_err!("只能预览已扫描到的本地 Skill"));
            }
            skill_io(fs::read_to_string(source.join("SKILL.md")))
        })
        .await
        .map_err(|error| app_err!("Skill 内容读取任务失败: {error}"))?
    }

    pub async fn scan_unmanaged_skills(&self) -> AppResult<Vec<SkillCandidate>> {
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Ok(Vec::new());
        };
        let repository = skill_repository(&self.paths.root);
        let sources = read_skill_sources(&repository);
        tauri::async_runtime::spawn_blocking(move || {
            let mut candidates = Vec::new();
            for (root, source) in [
                (home.join(".codex/skills"), "Codex"),
                (home.join(".agents/skills"), "Agent"),
            ] {
                let Ok(entries) = fs::read_dir(root) else {
                    continue;
                };
                for entry in entries.flatten() {
                    let path = entry.path();
                    let name = entry.file_name().to_string_lossy().to_string();
                    if !path.join("SKILL.md").is_file() {
                        continue;
                    }
                    let managed = repository.join(&name);
                    if managed.is_dir() {
                        // 已管理 Skill 只认导入时记录的外部本源，避免把另一边的旧分发副本误报成更新。
                        if let Some(source_path) = sources.get(&name).map(PathBuf::from) {
                            if !same_skill_path(&source_path, &path) {
                                continue;
                            }
                        }
                        if directories_equal(&managed, &path) {
                            continue;
                        }
                    }
                    if candidates.iter().any(|candidate: &SkillCandidate| {
                        candidate.name == name
                            && directories_equal(Path::new(&candidate.store_path), &path)
                    }) {
                        continue;
                    }
                    candidates.push(SkillCandidate {
                        name,
                        description: read_skill_description(&path.join("SKILL.md")),
                        store_path: path.display().to_string(),
                        source: source.to_string(),
                        has_content_conflict: false,
                        is_update: managed.is_dir(),
                        modified_at: skill_modified_at(&path),
                    });
                }
            }
            for index in 0..candidates.len() {
                let name = candidates[index].name.clone();
                let path = PathBuf::from(&candidates[index].store_path);
                candidates[index].has_content_conflict =
                    candidates.iter().enumerate().any(|(other_index, other)| {
                        other_index != index
                            && other.name == name
                            && !directories_equal(&path, Path::new(&other.store_path))
                    });
            }
            candidates.sort_by(|left, right| {
                left.name
                    .cmp(&right.name)
                    .then_with(|| left.source.cmp(&right.source))
            });
            Ok(candidates)
        })
        .await
        .map_err(|error| app_err!("Skill 扫描任务失败: {error}"))?
    }

    pub async fn import_skill(&self, source_path: &str) -> AppResult<()> {
        let repository = skill_repository(&self.paths.root);
        let source = PathBuf::from(source_path);
        tauri::async_runtime::spawn_blocking(move || {
            let name = source
                .file_name()
                .and_then(|item| item.to_str())
                .ok_or_else(|| app_err!("无法识别 Skill 名称"))?;
            validate_plugin_name(name)?;
            let target = repository.join(name);
            if source == target {
                return Err(app_err!("该 Skill 已在管理目录中"));
            }
            backup_skill(&repository, name)?;
            replace_skill(&source, &target)?;
            let mut sources = read_skill_sources(&repository);
            sources.insert(name.to_string(), source.display().to_string());
            write_skill_sources(&repository, &sources)?;
            Ok(())
        })
        .await
        .map_err(|error| app_err!("Skill 导入任务失败: {error}"))?
    }

    pub async fn enable_skill(&self, name: &str) -> AppResult<()> {
        validate_plugin_name(name)?;
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        let repository = skill_repository(&self.paths.root);
        let name = name.to_string();
        tauri::async_runtime::spawn_blocking(move || distribute_skill(&home, &repository, &name))
            .await
            .map_err(|error| app_err!("Skill 启用任务失败: {error}"))?
    }

    pub async fn disable_skill(&self, name: &str) -> AppResult<()> {
        validate_plugin_name(name)?;
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        let name = name.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let distributed = home.join(".codex/skills").join(&name);
            if distributed.is_dir() {
                skill_io(fs::remove_dir_all(distributed))?;
            }
            Ok(())
        })
        .await
        .map_err(|error| app_err!("Skill 停用任务失败: {error}"))?
    }

    pub async fn delete_skill(&self, name: &str) -> AppResult<()> {
        validate_plugin_name(name)?;
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        let repository = skill_repository(&self.paths.root);
        let name = name.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            let stored = repository.join(&name);
            if !stored.is_dir() {
                return Err(app_err!("Skill 不存在"));
            }
            skill_io(fs::remove_dir_all(&stored))?;
            let distributed = home.join(".codex/skills").join(&name);
            if distributed.is_dir() {
                skill_io(fs::remove_dir_all(distributed))?;
            }
            let mut sources = read_skill_sources(&repository);
            sources.remove(&name);
            write_skill_sources(&repository, &sources)
        })
        .await
        .map_err(|error| app_err!("Skill 删除任务失败: {error}"))?
    }

    /// 进入插件详情时再读取该插件内的 Skill 明细，避免列表阶段扫描所有插件目录。
    pub async fn list_plugin_skills(
        &self,
        name: &str,
        requested_store_path: Option<&str>,
    ) -> AppResult<Vec<PluginSkill>> {
        validate_plugin_name(name)?;
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        let codex_home = self.paths.codex_home.clone();
        let name = name.to_string();
        let requested_store_path = requested_store_path.map(str::to_owned);
        tauri::async_runtime::spawn_blocking(move || {
            let mut store_path = requested_store_path
                .as_deref()
                .and_then(|path| trusted_plugin_store_path(&home, &codex_home, &name, path));
            if store_path.is_none() {
                store_path = list_plugins_sync(&home, &codex_home)?
                    .into_iter()
                    .find(|item| item.name == name)
                    .map(|item| PathBuf::from(item.store_path));
            }
            let store_path = store_path.ok_or_else(|| app_err!("没有找到名为「{name}」的插件"))?;
            if !store_path.is_dir() {
                return Ok(Vec::new());
            }
            Ok(store_skills(&store_path))
        })
        .await
        .map_err(|error| app_err!("插件 Skill 读取任务失败: {error}"))?
    }

    /// 读取 Codex 当前配置中的插件市场，包含官方与外部市场。
    pub async fn list_plugin_marketplaces(&self) -> AppResult<Vec<PluginMarketplace>> {
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Ok(Vec::new());
        };
        tauri::async_runtime::spawn_blocking(move || {
            let output = run_codex_plugin(&home, &["marketplace", "list"])?;
            let mut items = parse_marketplace_list_output(&output);
            enrich_marketplace_metadata(&mut items, &marketplace_sources(&home));
            sort_marketplaces(&mut items);
            Ok(items)
        })
        .await
        .map_err(|error| app_err!("插件市场列表任务失败: {error}"))?
    }

    /// 读取 Codex 已配置市场的官方目录快照；available 同时包含已装与未装条目。
    pub async fn list_marketplace_plugins(
        &self,
        marketplace: &str,
        root: Option<&str>,
    ) -> AppResult<Vec<MarketplacePlugin>> {
        validate_plugin_name(marketplace)?;
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Ok(Vec::new());
        };
        let marketplace = marketplace.to_string();
        let root = root
            .filter(|value| !value.trim().is_empty())
            .map(PathBuf::from);
        tauri::async_runtime::spawn_blocking(move || {
            let output = run_codex_plugin(
                &home,
                &[
                    "list",
                    "--marketplace",
                    &marketplace,
                    "--available",
                    "--json",
                ],
            )?;
            parse_marketplace_plugins_output(&output, &marketplace, root.as_deref())
        })
        .await
        .map_err(|error| app_err!("插件市场目录任务失败: {error}"))?
    }

    /// 按 Codex 官方选择器安装已配置市场中的插件，并继承当前 live config.toml 的供应商配置。
    pub async fn install_marketplace_plugin(
        &self,
        marketplace: &str,
        name: &str,
    ) -> AppResult<PluginSummary> {
        validate_plugin_name(marketplace)?;
        validate_plugin_name(name)?;
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        let marketplace = marketplace.to_string();
        let name = name.to_string();
        tauri::async_runtime::spawn_blocking({
            let home = home.clone();
            let marketplace = marketplace.clone();
            let name = name.clone();
            move || run_codex_plugin(&home, &["add", &name, "--marketplace", &marketplace])
        })
        .await
        .map_err(|error| app_err!("安装插件任务失败: {error}"))??;

        let _ = self.database.record_event(
            None,
            "plugin",
            "install",
            Some(&format!("{name}@{marketplace}")),
            &now_ms().to_string(),
        );

        self.list_plugins()
            .await?
            .into_iter()
            .find(|plugin| plugin.name == name)
            .ok_or_else(|| app_err!("插件「{name}」已执行安装，但列表中尚未出现"))
    }

    /// 刷新第三方 Git 市场快照，并找出版本变化的已安装插件。
    pub async fn check_plugin_updates(&self) -> AppResult<Vec<PluginUpdate>> {
        let marketplaces = self.list_plugin_marketplaces().await?;
        let third_party: Vec<_> = marketplaces
            .into_iter()
            .filter(|marketplace| marketplace.kind == "third-party")
            .collect();
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Ok(Vec::new());
        };
        let names: Vec<_> = third_party
            .iter()
            .map(|marketplace| marketplace.name.clone())
            .collect();
        tauri::async_runtime::spawn_blocking(move || {
            for name in names {
                run_codex_plugin(&home, &["marketplace", "upgrade", &name])?;
            }
            Ok(())
        })
        .await
        .map_err(|error| app_err!("检查插件更新任务失败: {error}"))??;

        let installed = self.list_plugins().await?;
        let mut updates = Vec::new();
        for marketplace in third_party {
            let available = self
                .list_marketplace_plugins(&marketplace.name, Some(&marketplace.root))
                .await?;
            updates.extend(find_plugin_updates(&installed, &available));
        }
        Ok(updates)
    }

    /// 用已刷新的外部市场快照重新安装指定插件。
    pub async fn upgrade_marketplace_plugin(&self, marketplace: &str, name: &str) -> AppResult<()> {
        validate_plugin_name(marketplace)?;
        validate_plugin_name(name)?;
        let marketplaces = self.list_plugin_marketplaces().await?;
        if !marketplaces
            .iter()
            .any(|item| item.name == marketplace && item.kind == "third-party")
        {
            return Err(app_err!("只能升级外部插件市场中的插件"));
        }
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        let selector = format!("{name}@{marketplace}");
        tauri::async_runtime::spawn_blocking(move || run_codex_plugin(&home, &["add", &selector]))
            .await
            .map_err(|error| app_err!("升级插件任务失败: {error}"))??;
        Ok(())
    }

    /// 添加 Git 插件市场，并返回 Codex 识别到的市场名。
    pub async fn add_plugin_marketplace(&self, url: &str) -> AppResult<PluginMarketplace> {
        let (source_arg, fallback_name) = parse_marketplace_source(url)?;
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        tauri::async_runtime::spawn_blocking(move || {
            let output = match run_codex_plugin(&home, &["marketplace", "add", &source_arg]) {
                Ok(output) => output,
                Err(error)
                    if error
                        .to_string()
                        .to_ascii_lowercase()
                        .contains("already added from a different source") =>
                {
                    let list_output = run_codex_plugin(&home, &["marketplace", "list"])?;
                    let mut marketplaces = parse_marketplace_list_output(&list_output);
                    enrich_marketplace_metadata(&mut marketplaces, &marketplace_sources(&home));
                    return marketplaces
                        .into_iter()
                        .find(|marketplace| marketplace.name == fallback_name)
                        .ok_or(error);
                }
                Err(error) => return Err(error),
            };
            let name = parse_marketplace_name(&output, &fallback_name);
            let list_output = run_codex_plugin(&home, &["marketplace", "list"])?;
            let mut marketplaces = parse_marketplace_list_output(&list_output);
            enrich_marketplace_metadata(&mut marketplaces, &marketplace_sources(&home));
            Ok(marketplaces
                .into_iter()
                .find(|marketplace| marketplace.name == name)
                .unwrap_or(PluginMarketplace {
                    name,
                    root: String::new(),
                    kind: "third-party".into(),
                    source_url: None,
                    display_name: None,
                    description: None,
                }))
        })
        .await
        .map_err(|error| app_err!("添加插件市场任务失败: {error}"))?
    }

    /// 移除第三方插件市场来源；遵循 Codex CLI 语义，不自动删除该市场下已安装的插件。
    pub async fn remove_plugin_marketplace(&self, name: &str) -> AppResult<()> {
        validate_plugin_name(name)?;
        let marketplaces = self.list_plugin_marketplaces().await?;
        let Some(marketplace) = marketplaces.iter().find(|item| item.name == name) else {
            return Err(app_err!("没有找到插件市场「{name}」"));
        };
        if marketplace.kind == "official" {
            return Err(app_err!("「{name}」属于 Codex 官方市场，不能在这里移除"));
        }
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        let name = name.to_string();
        let command_name = name.clone();
        tauri::async_runtime::spawn_blocking(move || {
            run_codex_plugin(&home, &["marketplace", "remove", &command_name])
        })
        .await
        .map_err(|error| app_err!("移除插件市场任务失败: {error}"))??;
        let _ = self.database.record_event(
            None,
            "plugin",
            "marketplace-remove",
            Some(&name),
            &now_ms().to_string(),
        );
        Ok(())
    }

    /// 预览：仓库元数据 + 每个插件根的清单与文件列表（不落盘）。
    pub async fn preview_plugin(&self, url: &str) -> AppResult<PluginPreview> {
        let source = parse_github_url(url)?;
        let tree = fetch_repo_tree(&source).await?;
        let roots: Vec<String> = plugin_roots(&tree.entries)
            .into_iter()
            .filter(|root| root_within(root, source.sub_path.as_deref().unwrap_or_default()))
            .collect();
        if roots.is_empty() {
            return Err(app_err!(
                "仓库里没有找到 {MANIFEST_RELATIVE_PATH}，请确认这是一个 Codex 插件仓库"
            ));
        }

        let mut candidates = Vec::new();
        for root in roots {
            let files = files_under_root(&tree.entries, &root);
            let relative_manifest = if root.is_empty() {
                MANIFEST_RELATIVE_PATH.to_string()
            } else {
                format!("{root}/{MANIFEST_RELATIVE_PATH}")
            };
            let manifest_bytes =
                fetch_raw_file(&source, &tree.reference, &relative_manifest).await?;
            let manifest = parse_manifest_text(&String::from_utf8_lossy(&manifest_bytes))?;
            validate_plugin_name(&manifest.name)?;
            let contains = derive_contains(&files);
            candidates.push(PluginCandidate {
                sub_path: root,
                name: manifest.name.clone(),
                version: manifest.version.clone(),
                display_name: manifest
                    .interface
                    .as_ref()
                    .and_then(|item| item.display_name.clone()),
                description: manifest_description(&manifest),
                capabilities: manifest
                    .interface
                    .as_ref()
                    .map(|item| item.capabilities.clone())
                    .unwrap_or_default(),
                contains,
                files: files
                    .iter()
                    .map(|path| path.to_string())
                    .take(preview_file_limit())
                    .collect(),
            });
        }
        Ok(PluginPreview {
            repo: format!("{}/{}", source.owner, source.repo),
            reference: tree.reference,
            default_branch: tree.default_branch,
            candidates,
        })
    }

    /// 安装：预览拿到插件名 → `marketplace add <owner/repo[@ref]>` → `plugin add <名>@<市场>`。
    /// 全程官方 CLI 路径，落盘与状态归 Codex 管。
    pub async fn install_plugin(
        &self,
        url: &str,
        sub_path: Option<&str>,
    ) -> AppResult<PluginSummary> {
        let source = parse_github_url(url)?;
        let tree = fetch_repo_tree(&source).await?;
        let target_sub = sub_path.or(source.sub_path.as_deref());
        let roots: Vec<String> = plugin_roots(&tree.entries)
            .into_iter()
            .filter(|root| root_within(root, target_sub.unwrap_or_default()))
            .collect();
        let root = match roots.as_slice() {
            [root] => root.clone(),
            [] => {
                return Err(app_err!(
                    "仓库里没有找到 {MANIFEST_RELATIVE_PATH}，请确认地址指向 Codex 插件目录"
                ))
            }
            _ => {
                return Err(app_err!(
                    "该地址下有 {} 个插件，请先预览并选择具体插件",
                    roots.len()
                ))
            }
        };
        let relative_manifest = if root.is_empty() {
            MANIFEST_RELATIVE_PATH.to_string()
        } else {
            format!("{root}/{MANIFEST_RELATIVE_PATH}")
        };
        let manifest_bytes = fetch_raw_file(&source, &tree.reference, &relative_manifest).await?;
        let manifest = parse_manifest_text(&String::from_utf8_lossy(&manifest_bytes))?;
        validate_plugin_name(&manifest.name)?;

        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        let source_arg = match &source.ref_name {
            Some(reference) => format!("{}/{}@{reference}", source.owner, source.repo),
            None => format!("{}/{}", source.owner, source.repo),
        };
        let selector_name = manifest.name.clone();
        // CLI 调用跑在 blocking 线程池（git 同步可能数十秒）
        let marketplace_name = tauri::async_runtime::spawn_blocking({
            let home = home.clone();
            let source_arg = source_arg.clone();
            move || {
                let output = run_codex_plugin(&home, &["marketplace", "add", &source_arg]);
                match output {
                    Ok(text) => parse_marketplace_name(&text, ""),
                    Err(error) => {
                        // 源可能已添加过（重复安装/升级）：忽略 add 错误，让 plugin add 兜底
                        let _ = error;
                        String::new()
                    }
                }
            }
        })
        .await
        .map_err(|error| app_err!("安装任务失败: {error}"))?;
        let marketplace_name = if marketplace_name.is_empty() {
            source.repo.clone()
        } else {
            marketplace_name
        };

        let selector = format!("{selector_name}@{marketplace_name}");
        tauri::async_runtime::spawn_blocking({
            let home = home.clone();
            let selector = selector.clone();
            move || run_codex_plugin(&home, &["add", &selector])
        })
        .await
        .map_err(|error| app_err!("安装任务失败: {error}"))??;

        let _ = self.database.record_event(
            None,
            "plugin",
            "install",
            Some(&format!("{selector}@{}", tree.reference)),
            &now_ms().to_string(),
        );

        // 从列表里取回安装后的真实状态（版本/路径由 Codex 维护）
        let plugins = self.list_plugins().await?;
        plugins
            .into_iter()
            .find(|item| item.name == manifest.name)
            .ok_or_else(|| {
                app_err!(
                    "安装命令已执行，但列表里没找到「{}」，请刷新查看",
                    manifest.name
                )
            })
    }

    /// 卸载：由 Codex CLI 管理的第三方插件走 `codex plugin remove`。
    pub async fn uninstall_plugin(&self, name: &str) -> AppResult<()> {
        validate_plugin_name(name)?;
        let Some(home) = self.paths.codex_home.parent().map(Path::to_path_buf) else {
            return Err(app_err!("无法定位用户主目录"));
        };
        if is_registered_skill(&home, name) {
            return Err(app_err!(
                "「{name}」属于 Codex Skill 注册表，请在 Codex 内管理它"
            ));
        }
        let plugins = self.list_plugins().await?;
        let Some(plugin) = plugins.iter().find(|item| item.name == name) else {
            return Err(app_err!("没有找到名为「{name}」的插件"));
        };
        if plugin.origin == "official" {
            return Err(app_err!(
                "「{name}」属于 Codex 官方市场，请在 Codex 内管理它"
            ));
        }
        if plugin.origin == "codex" {
            let marketplace = plugin
                .marketplace
                .clone()
                .ok_or_else(|| app_err!("缺少「{name}」的市场信息，无法调用卸载"))?;
            let selector = format!("{name}@{marketplace}");
            tauri::async_runtime::spawn_blocking({
                let home = home.clone();
                let selector = selector.clone();
                move || run_codex_plugin(&home, &["remove", &selector])
            })
            .await
            .map_err(|error| app_err!("卸载任务失败: {error}"))??;
            let _ = self.database.record_event(
                None,
                "plugin",
                "uninstall",
                Some(name),
                &now_ms().to_string(),
            );
            return Ok(());
        }
        Err(app_err!("不支持的插件来源"))
    }
}

/// list_plugins 的同步实现（跑在 blocking 线程池）。
fn list_plugins_sync(home: &Path, codex_home: &Path) -> AppResult<Vec<PluginSummary>> {
    let sources = marketplace_sources(home);
    let mut summaries: Vec<PluginSummary> = Vec::new();

    // 1) `codex plugin list`（主源）：覆盖运行时、捆绑和外部市场，含启停状态
    if find_codex_cli(home).is_some() {
        if let Ok(output) = run_codex_plugin(home, &["list"]) {
            for (name, marketplace, enabled, version, path) in parse_plugin_list_output(&output) {
                let origin = if marketplace.starts_with("openai") {
                    "official"
                } else {
                    "codex"
                };
                let plugin_path =
                    plugin_store_path(codex_home, &marketplace, &name, version.as_deref(), &path);
                let manifest = read_manifest(&plugin_path);
                summaries.push(PluginSummary {
                    version: version.or(manifest.as_ref().and_then(|item| item.version.clone())),
                    display_name: manifest
                        .as_ref()
                        .and_then(|item| item.interface.as_ref())
                        .and_then(|item| item.display_name.clone()),
                    description: manifest.as_ref().and_then(manifest_description),
                    category: manifest
                        .as_ref()
                        .and_then(|item| item.interface.as_ref())
                        .and_then(|item| item.category.clone()),
                    capabilities: manifest
                        .as_ref()
                        .and_then(|item| item.interface.as_ref())
                        .map(|item| item.capabilities.clone())
                        .unwrap_or_default(),
                    contains: if plugin_path.is_dir() {
                        store_contains(&plugin_path)
                    } else {
                        Vec::new()
                    },
                    enabled,
                    origin: origin.to_string(),
                    marketplace: Some(marketplace),
                    store_path: plugin_path.display().to_string(),
                    source_url: None,
                    name,
                });
            }
        } else {
            // CLI 在但 list 失败：回退缓存扫描
            summaries.extend(scan_codex_plugin_cache(codex_home));
        }
    } else {
        summaries.extend(scan_codex_plugin_cache(codex_home));
    }
    enrich_plugin_sources(&mut summaries, &sources);
    summaries.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(summaries)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str) -> TreeEntry {
        TreeEntry {
            path: path.to_string(),
            kind: "blob".into(),
        }
    }

    #[test]
    fn plugin_roots_find_nested_and_root_plugins() {
        let entries = vec![
            entry(".codex-plugin/plugin.json"),
            entry("skills/a/SKILL.md"),
            entry("plugins/foo/.codex-plugin/plugin.json"),
            entry("plugins/foo/skills/b/SKILL.md"),
            entry("plugins/foo/node_modules/x/.codex-plugin/plugin.json"),
        ];
        let roots = plugin_roots(&entries);
        assert_eq!(
            roots,
            vec![
                "".to_string(),
                "plugins/foo".to_string(),
                "plugins/foo/node_modules/x".to_string()
            ]
        );
    }

    #[test]
    fn root_within_matches_self_and_children_only() {
        assert!(root_within("plugins/foo", "plugins"));
        assert!(root_within("plugins/foo", "plugins/foo"));
        assert!(!root_within("plugins/foobar", "plugins/foo"));
        assert!(root_within("anything", ""));
    }

    #[test]
    fn derive_contains_labels_content_types() {
        let files = vec!["skills/a/SKILL.md", ".mcp.json", "hooks.json"];
        assert_eq!(derive_contains(&files), vec!["skills", "mcp", "hooks"]);
    }

    #[test]
    fn store_skills_reads_names_and_descriptions() {
        let root = tempfile::tempdir().unwrap();
        let skill_dir = root.path().join("skills").join("session-summary");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\ndescription: Summarize sessions\n---\n# Session summary\n",
        )
        .unwrap();

        let skills = store_skills(root.path());
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "session-summary");
        assert_eq!(skills[0].path, "skills/session-summary/SKILL.md");
        assert_eq!(skills[0].description.as_deref(), Some("Summarize sessions"));
    }

    #[test]
    fn plugin_store_path_falls_back_to_cached_version_for_git_source() {
        let codex_home = tempfile::tempdir().unwrap();
        let cached = codex_home
            .path()
            .join(PLUGIN_CACHE_RELATIVE_PATH)
            .join("ponytail")
            .join("ponytail")
            .join("4.9.0");
        std::fs::create_dir_all(&cached).unwrap();

        assert_eq!(
            plugin_store_path(
                codex_home.path(),
                "ponytail",
                "ponytail",
                Some("4.9.0"),
                "https://github.com/DietrichGebert/ponytail.git, ref `main`",
            ),
            cached
        );
    }

    #[test]
    fn resolve_local_path_accepts_prefix_and_cursor_style() {
        let home = Path::new("/home/user");
        assert_eq!(
            resolve_local_path(home, "./plugins/foo"),
            Some(home.join("plugins/foo"))
        );
        assert_eq!(
            resolve_local_path(home, "plugins/foo"),
            Some(home.join("plugins/foo"))
        );
        assert_eq!(resolve_local_path(home, "../escape"), None);
        assert_eq!(resolve_local_path(home, "/absolute"), None);
    }

    #[test]
    fn entry_local_path_supports_string_and_object_forms() {
        let string_form = json!({ "name": "a", "source": "./plugins/a" });
        assert_eq!(
            entry_local_path(&string_form).as_deref(),
            Some("./plugins/a")
        );
        let object_form =
            json!({ "name": "b", "source": { "source": "local", "path": "./plugins/b" } });
        assert_eq!(
            entry_local_path(&object_form).as_deref(),
            Some("./plugins/b")
        );
        let url_form = json!({ "name": "c", "source": { "source": "url", "url": "https://github.com/x/y.git" } });
        assert_eq!(entry_local_path(&url_form), None);
    }

    #[test]
    fn manifest_parses_official_sample() {
        let text = r#"{
            "name": "memory-bank",
            "version": "1.0.0",
            "description": "Memory management",
            "interface": { "displayName": "Memory Bank", "category": "memory", "capabilities": ["read", "write"] }
        }"#;
        let manifest = parse_manifest_text(text).unwrap();
        assert_eq!(manifest.name, "memory-bank");
        assert_eq!(manifest.version.as_deref(), Some("1.0.0"));
        assert_eq!(
            manifest.interface.unwrap().display_name.as_deref(),
            Some("Memory Bank")
        );
    }

    #[test]
    fn plugin_list_output_parses_status_and_versions() {
        let output = "\
Marketplace `openai-bundled`
C:\\users\\\\.codex\\.tmp\\bundled-marketplaces\\openai-bundled\\.agents\\plugins\\marketplace.json

PLUGIN                           STATUS              VERSION       PATH
codex-app-tools@openai-bundled  installed, enabled  0.1.0         C:\\bundle\\plugins\\codex-app-tools
latex@openai-bundled            not installed                     C:\\bundle\\plugins\\latex
ponytail@ponytail               installed, disabled 4.9.0         C:\\cache\\ponytail\\ponytail\\4.9.0
";
        let items = parse_plugin_list_output(output);
        assert_eq!(items.len(), 2);
        assert_eq!(
            items[0],
            (
                "codex-app-tools".into(),
                "openai-bundled".into(),
                true,
                Some("0.1.0".into()),
                "C:\\bundle\\plugins\\codex-app-tools".into()
            )
        );
        assert!(!items[1].2);
        assert_eq!(items[1].1, "ponytail");
    }

    #[test]
    fn marketplace_name_falls_back_to_repo() {
        assert_eq!(
            parse_marketplace_name("added Marketplace `ponytail` ok", "fallback"),
            "ponytail"
        );
        assert_eq!(
            parse_marketplace_name("no backticks here", "my-repo"),
            "my-repo"
        );
    }

    #[test]
    fn marketplace_list_output_parses_third_party_marketplaces() {
        let output = "MARKETPLACE             ROOT\nopenai-bundled          C:\\bundled\nponytail                C:\\marketplaces\\ponytail\n";
        let items = parse_marketplace_list_output(output);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].name, "openai-bundled");
        assert_eq!(items[0].kind, "official");
        assert_eq!(items[1].name, "ponytail");
        assert_eq!(items[1].kind, "third-party");
        assert_eq!(items[1].root, "C:\\marketplaces\\ponytail");
    }

    #[test]
    fn marketplaces_sort_official_before_third_party_then_name() {
        let mut items = vec![
            PluginMarketplace {
                name: "zeta".into(),
                kind: "third-party".into(),
                ..Default::default()
            },
            PluginMarketplace {
                name: "beta".into(),
                kind: "official".into(),
                ..Default::default()
            },
            PluginMarketplace {
                name: "alpha".into(),
                kind: "official".into(),
                ..Default::default()
            },
            PluginMarketplace {
                name: "agent".into(),
                kind: "third-party".into(),
                ..Default::default()
            },
        ];

        sort_marketplaces(&mut items);

        assert_eq!(
            items.into_iter().map(|item| item.name).collect::<Vec<_>>(),
            ["alpha", "beta", "agent", "zeta"]
        );
    }

    #[test]
    fn plugin_updates_ignore_official_and_match_newer_third_party_versions() {
        let updates = find_plugin_updates(
            &[
                PluginSummary {
                    name: "official-plugin".into(),
                    version: Some("1.0.0".into()),
                    origin: "official".into(),
                    marketplace: Some("openai-bundled".into()),
                    ..Default::default()
                },
                PluginSummary {
                    name: "ponytail".into(),
                    version: Some("4.9.0".into()),
                    origin: "codex".into(),
                    marketplace: Some("ponytail".into()),
                    ..Default::default()
                },
            ],
            &[MarketplacePlugin {
                plugin_id: "ponytail@ponytail".into(),
                name: "ponytail".into(),
                version: Some("5.0.0".into()),
                installed: true,
                ..Default::default()
            }],
        );

        assert_eq!(updates.len(), 1);
        assert_eq!(updates[0].name, "ponytail");
        assert_eq!(updates[0].marketplace, "ponytail");
        assert_eq!(updates[0].version, "5.0.0");
    }

    #[test]
    fn marketplace_sources_read_git_source_from_codex_config() {
        let temp = tempfile::tempdir().unwrap();
        let codex = temp.path().join(".codex");
        std::fs::create_dir_all(&codex).unwrap();
        std::fs::write(
            codex.join("config.toml"),
            "[marketplaces.youmind]\nsource_type = \"git\"\nsource = \"https://github.com/YouMind-OpenLab/plugin-marketplace.git\"\n\n[marketplaces.local]\nsource_type = \"local\"\nsource = \"C:/plugins/local\"\n",
        )
        .unwrap();

        let sources = marketplace_sources(temp.path());
        assert_eq!(
            sources.get("youmind").map(String::as_str),
            Some("https://github.com/YouMind-OpenLab/plugin-marketplace.git")
        );
        assert!(!sources.contains_key("local"));
    }

    #[test]
    fn marketplace_plugin_json_keeps_installed_and_available_entries() {
        let output = r#"{
          "installed": [{
            "pluginId": "ponytail@ponytail",
            "name": "ponytail",
            "marketplaceName": "ponytail",
            "version": "4.9.0",
            "installed": true,
            "enabled": true,
            "installPolicy": "AVAILABLE",
            "authPolicy": "ON_INSTALL",
            "source": {"source": "git", "url": "https://github.com/DietrichGebert/ponytail.git"}
          }],
          "available": [{
            "pluginId": "grill@other",
            "name": "grill",
            "marketplaceName": "other",
            "version": "1.3.0",
            "installed": false,
            "enabled": false,
            "installPolicy": "AVAILABLE",
            "authPolicy": "ON_USE",
            "source": {"source": "url", "url": "https://example.com/grill.git"}
          }]
        }"#;
        let items = parse_marketplace_plugins_output(output, "ponytail", None).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].plugin_id, "ponytail@ponytail");
        assert!(items[0].installed);
        assert_eq!(
            items[0].source.as_deref(),
            Some("https://github.com/DietrichGebert/ponytail.git")
        );
    }

    #[test]
    fn marketplace_plugin_metadata_reads_catalog_and_local_manifest() {
        let root = tempfile::tempdir().unwrap();
        let marketplace_dir = root.path().join(".agents/plugins");
        let plugin_dir = root.path().join("plugins/local-tool/.codex-plugin");
        std::fs::create_dir_all(&marketplace_dir).unwrap();
        std::fs::create_dir_all(&plugin_dir).unwrap();
        std::fs::write(
            marketplace_dir.join("marketplace.json"),
            r#"{
              "name": "fixture",
              "interface": {"displayName": "Fixture Market"},
              "metadata": {"description": "Fixture market description"},
              "plugins": [{
                "name": "local-tool",
                "description": "Catalog description",
                "category": "Productivity",
                "keywords": ["local", "fixture"],
                "source": "./plugins/local-tool"
              }]
            }"#,
        )
        .unwrap();
        std::fs::write(
            plugin_dir.join("plugin.json"),
            r#"{
              "name": "local-tool",
              "version": "2.0.0",
              "interface": {
                "displayName": "Local Tool",
                "capabilities": ["Read", "Write"]
              }
            }"#,
        )
        .unwrap();
        let output = r#"{
          "available": [{
            "pluginId": "local-tool@fixture",
            "name": "local-tool",
            "marketplaceName": "fixture",
            "installed": false,
            "enabled": false,
            "installPolicy": "AVAILABLE",
            "authPolicy": "ON_USE",
            "source": "./plugins/local-tool"
          }]
        }"#;

        let items = parse_marketplace_plugins_output(output, "fixture", Some(root.path())).unwrap();
        assert_eq!(items[0].display_name.as_deref(), Some("Local Tool"));
        assert_eq!(items[0].description.as_deref(), Some("Catalog description"));
        assert_eq!(items[0].category.as_deref(), Some("Productivity"));
        assert_eq!(
            items[0].capabilities,
            vec!["Read".to_string(), "Write".to_string()]
        );
        assert_eq!(items[0].version.as_deref(), Some("2.0.0"));
    }

    #[test]
    fn plugin_name_rejects_selector_characters() {
        assert!(validate_plugin_name("memory-bank").is_ok());
        assert!(validate_plugin_name("a@b").is_err());
        assert!(validate_plugin_name("../x").is_err());
    }

    #[test]
    fn marketplace_source_accepts_codex_supported_forms() {
        assert_eq!(
            parse_marketplace_source("owner/repo@main").unwrap().0,
            "owner/repo@main"
        );
        assert_eq!(
            parse_marketplace_source("https://git.example.com/plugins.git").unwrap(),
            (
                "https://git.example.com/plugins.git".into(),
                "plugins".into()
            )
        );
        assert!(parse_marketplace_source("not-a-marketplace").is_err());
    }

    fn context() -> (tempfile::TempDir, AppContext) {
        let home = tempfile::tempdir().unwrap();
        let paths = crate::paths::from_home(home.path()).unwrap();
        paths.ensure().unwrap();
        let context = AppContext::new(paths).unwrap();
        (home, context)
    }

    #[tokio::test]
    async fn list_plugins_reads_skill_lock_and_cache_fallback() {
        let (home, context) = context();
        // 无 codex CLI 的环境（CI）：走缓存回退
        let skill_dir = home.path().join(".agents/skills/lark-base");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\ndescription: 飞书多维表格操作\n---\n",
        )
        .unwrap();
        std::fs::write(
            home.path().join(".agents/.skill-lock.json"),
            r#"{"version":3,"skills":{"lark-base":{"source":"larksuite/cli","sourceType":"github","sourceUrl":"https://github.com/larksuite/cli.git","skillPath":"skills/lark-base/SKILL.md","skillFolderHash":"abc","installedAt":"2026-05-09T10:06:04.288Z"}}}"#,
        )
        .unwrap();
        let cache_dir = home
            .path()
            .join(".codex")
            .join("plugins")
            .join("cache")
            .join("ponytail")
            .join("ponytail")
            .join("4.9.0")
            .join(".codex-plugin");
        std::fs::create_dir_all(&cache_dir).unwrap();
        std::fs::write(
            cache_dir.join("plugin.json"),
            r#"{"name":"ponytail","description":"Ponytail 插件"}"#,
        )
        .unwrap();
        let skill_dir = cache_dir
            .parent()
            .unwrap()
            .join("skills")
            .join("plugin-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\ndescription: 插件内的 Skill\n---\n",
        )
        .unwrap();
        std::fs::write(
            home.path().join(".codex/config.toml"),
            "[marketplaces.ponytail]\nsource = \"https://github.com/DietrichGebert/ponytail.git\"\n",
        )
        .unwrap();

        assert!(context.list_skills().await.unwrap().is_empty());

        let plugins = context.list_plugins().await.unwrap();
        assert!(plugins.iter().all(|item| item.name != "lark-base"));
        let ponytail = plugins.iter().find(|item| item.name == "ponytail").unwrap();
        assert_eq!(ponytail.origin, "codex");
        assert_eq!(ponytail.marketplace.as_deref(), Some("ponytail"));
        assert_eq!(ponytail.version.as_deref(), Some("4.9.0"));
        assert_eq!(
            ponytail.source_url.as_deref(),
            Some("https://github.com/DietrichGebert/ponytail.git")
        );
        let plugin_skills = context
            .list_plugin_skills("ponytail", Some(&ponytail.store_path))
            .await
            .unwrap();
        assert_eq!(plugin_skills.len(), 1);
        assert_eq!(plugin_skills[0].name, "plugin-skill");
    }

    #[tokio::test]
    async fn readonly_plugins_reject_uninstall() {
        let (home, context) = context();
        std::fs::create_dir_all(home.path().join(".agents/skills")).unwrap();
        std::fs::write(
            home.path().join(".agents/.skill-lock.json"),
            r#"{"version":3,"skills":{"lark-base":{"source":"larksuite/cli","sourceType":"github"}}}"#,
        )
        .unwrap();
        let error = context.uninstall_plugin("lark-base").await.unwrap_err();
        assert!(error.0.contains("Skill 注册表"));
    }

    #[tokio::test]
    async fn scan_unmanaged_skills_deduplicates_identical_skills() {
        let (home, context) = context();
        for root in [".agents/skills", ".codex/skills"] {
            let skill = home.path().join(root).join("same-skill");
            std::fs::create_dir_all(&skill).unwrap();
            std::fs::write(skill.join("SKILL.md"), "---\ndescription: 相同内容\n---\n").unwrap();
        }

        let candidates = context.scan_unmanaged_skills().await.unwrap();
        assert_eq!(
            candidates
                .iter()
                .filter(|candidate| candidate.name == "same-skill")
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn scan_unmanaged_skills_marks_same_name_with_different_content() {
        let (home, context) = context();
        for (root, content) in [
            (".agents/skills", "---\ndescription: 版本 A\n---\n"),
            (".codex/skills", "---\ndescription: 版本 B\n---\n"),
        ] {
            let skill = home.path().join(root).join("different-skill");
            std::fs::create_dir_all(&skill).unwrap();
            std::fs::write(skill.join("SKILL.md"), content).unwrap();
        }

        let candidates = context.scan_unmanaged_skills().await.unwrap();
        let matches: Vec<_> = candidates
            .iter()
            .filter(|candidate| candidate.name == "different-skill")
            .collect();
        assert_eq!(matches.len(), 2);
        assert!(matches
            .iter()
            .all(|candidate| candidate.has_content_conflict));
    }

    #[tokio::test]
    async fn scan_unmanaged_skills_reports_auxiliary_changes() {
        let (home, context) = context();
        for root in [".agents/skills", ".codex/skills"] {
            let skill = home.path().join(root).join("matching-skill");
            std::fs::create_dir_all(skill.join("logs")).unwrap();
            std::fs::write(skill.join("SKILL.md"), "---\ndescription: 相同内容\n---\n").unwrap();
            std::fs::write(skill.join("logs/source.md"), root).unwrap();
        }

        let candidates = context.scan_unmanaged_skills().await.unwrap();
        let matches: Vec<_> = candidates
            .iter()
            .filter(|candidate| candidate.name == "matching-skill")
            .collect();
        assert_eq!(matches.len(), 2);
        assert!(matches
            .iter()
            .all(|candidate| candidate.has_content_conflict));
        assert!(matches.iter().all(|candidate| !candidate.is_update));
    }

    #[tokio::test]
    async fn scan_unmanaged_skills_reports_managed_updates() {
        let (home, context) = context();
        let repository_root = skill_repository(&context.paths.root);
        let repository = repository_root.join("managed-skill");
        std::fs::create_dir_all(&repository).unwrap();
        std::fs::write(
            repository.join("SKILL.md"),
            "---\ndescription: 旧版本\n---\n",
        )
        .unwrap();

        let agent_skill = home.path().join(".agents/skills/managed-skill");
        let codex_skill = home.path().join(".codex/skills/managed-skill");
        for (skill, description) in [
            (&agent_skill, "Agent 旧副本"),
            (&codex_skill, "Codex 新版本"),
        ] {
            std::fs::create_dir_all(skill).unwrap();
            std::fs::write(
                skill.join("SKILL.md"),
                format!("---\ndescription: {description}\n---\n"),
            )
            .unwrap();
        }
        write_skill_sources(
            &repository_root,
            &BTreeMap::from([(
                "managed-skill".to_string(),
                codex_skill.display().to_string(),
            )]),
        )
        .unwrap();

        let candidates = context.scan_unmanaged_skills().await.unwrap();
        let matches: Vec<_> = candidates
            .iter()
            .filter(|candidate| candidate.name == "managed-skill")
            .collect();
        assert_eq!(matches.len(), 1);
        assert!(matches[0].is_update);
        assert!(!matches[0].has_content_conflict);
        assert_eq!(matches[0].source, "Codex");
    }

    #[tokio::test]
    async fn local_skill_import_and_update_keep_plugin_skills_separate() {
        let (home, context) = context();
        let source = home.path().join("Downloads/local-skill");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::write(source.join("SKILL.md"), "---\ndescription: 初始版本\n---\n").unwrap();

        context
            .import_skill(&source.display().to_string())
            .await
            .unwrap();
        let initial = context.list_skills().await.unwrap();
        assert_eq!(
            initial
                .iter()
                .find(|skill| skill.name == "local-skill")
                .unwrap()
                .description
                .as_deref(),
            Some("初始版本")
        );
        let codex_skill = home.path().join(".codex/skills/local-skill");
        std::fs::create_dir_all(&codex_skill).unwrap();
        std::fs::write(
            codex_skill.join("SKILL.md"),
            "---\ndescription: Codex 中已修改\n---\n",
        )
        .unwrap();
        assert!(
            context
                .list_skills()
                .await
                .unwrap()
                .iter()
                .find(|skill| skill.name == "local-skill")
                .unwrap()
                .enabled
        );

        std::fs::write(source.join("SKILL.md"), "---\ndescription: 更新版本\n---\n").unwrap();
        assert!(
            context
                .list_skills()
                .await
                .unwrap()
                .iter()
                .find(|skill| skill.name == "local-skill")
                .unwrap()
                .update_available
        );
        context
            .import_skill(&source.display().to_string())
            .await
            .unwrap();
        assert_eq!(
            context
                .list_skills()
                .await
                .unwrap()
                .iter()
                .find(|skill| skill.name == "local-skill")
                .unwrap()
                .description
                .as_deref(),
            Some("更新版本")
        );
    }
}
