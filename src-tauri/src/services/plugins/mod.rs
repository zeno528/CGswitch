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

use std::path::Path;

use serde::{Deserialize, Serialize};

#[cfg(test)]
use serde_json::json;

#[cfg(test)]
use crate::services::plugin_net::TreeEntry;

#[cfg(test)]
use super::AppContext;
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
    pub contains: Vec<String>,
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
pub(super) struct PluginManifest {
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
pub(super) struct PluginInterface {
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

pub(super) const MANIFEST_RELATIVE_PATH: &str = ".codex-plugin/plugin.json";
/// Claude 布局的清单回退路径（多 Agent 插件两种都有，如 ponytail）。
pub(super) const CLAUDE_MANIFEST_RELATIVE_PATH: &str = ".claude-plugin/plugin.json";
pub(super) const SKILL_SOURCE_FILE: &str = ".sources.json";
pub(super) const SKILL_BACKUP_DIRECTORY: &str = ".backups";
/// Codex marketplace 插件的物化缓存（相对 codex home，CLI 缺席时的回退数据源）。
pub(super) const PLUGIN_CACHE_RELATIVE_PATH: &str = "plugins/cache";

use catalog::manifest_description;

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

mod catalog;
mod cli;
mod ops;
mod skills;
mod store;

pub use cli::detect_system_proxy;

#[cfg(test)]
mod tests {
    use super::catalog::*;
    use super::cli::*;
    use super::ops::*;
    use super::skills::*;
    use super::store::*;
    use super::*;
    use std::collections::BTreeMap;
    use std::path::PathBuf;
    use std::process::Stdio;
    use std::time::{Duration, Instant};

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
    fn read_skill_description_folds_block_scalar() {
        // 实测样本（nezha-manager 等）：`>` 折叠块曾整段被跳过导致卡片无描述
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("SKILL.md");
        std::fs::write(
            &path,
            "---\nname: demo\ndescription: >\n  First folded line\n  continues here.\n\n  Second paragraph.\nlicense: MIT\n---\n# body\n",
        )
        .unwrap();

        assert_eq!(
            read_skill_description(&path).as_deref(),
            Some("First folded line continues here.\nSecond paragraph.")
        );
    }

    #[test]
    fn read_skill_description_keeps_literal_block_lines() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("SKILL.md");
        std::fs::write(
            &path,
            "---\ndescription: |-\n  Step one\n  Step two\n---\n# body\n",
        )
        .unwrap();

        assert_eq!(
            read_skill_description(&path).as_deref(),
            Some("Step one\nStep two")
        );
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
    fn install_marketplace_redirects_to_remote_identity() {
        let identities = vec![
            "openai-primary-runtime".to_string(),
            "openai-bundled".to_string(),
            "ponytail".to_string(),
            "openai-curated-remote".to_string(),
        ];
        // 镜像名 → 远程原体（桌面端注册表口径）
        assert_eq!(
            resolve_install_marketplace("openai-curated", &identities),
            "openai-curated-remote"
        );
        // 无 -remote 原体的市场保持原样
        assert_eq!(
            resolve_install_marketplace("ponytail", &identities),
            "ponytail"
        );
        // 解析器只认 "Marketplace `X`" 头部行
        let listing = "Marketplace `a`\n\nPLUGIN  STATUS\nx@a  installed, enabled  1.0  C:\\x\nMarketplace `b`\n";
        assert_eq!(parse_marketplace_identities(listing), vec!["a", "b"]);
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
        std::fs::create_dir_all(root.path().join("plugins/local-tool/skills/example")).unwrap();
        std::fs::write(
            root.path()
                .join("plugins/local-tool/skills/example/SKILL.md"),
            "# Example",
        )
        .unwrap();
        std::fs::write(root.path().join("plugins/local-tool/.mcp.json"), "{}").unwrap();
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
        assert_eq!(items[0].contains, vec!["skills", "mcp"]);
    }

    #[test]
    fn cli_candidates_prefer_path_before_desktop_appserver() {
        let home = Path::new("/home/user");
        let candidates = cli_candidates(
            home,
            vec![PathBuf::from("/usr/local/bin"), PathBuf::from("/usr/bin")],
        );
        let filename = codex_cli_file_name();
        assert_eq!(candidates[0], home.join(".codex/bin").join(filename));
        assert_eq!(candidates[1], Path::new("/usr/local/bin").join(filename));
        assert_eq!(candidates[2], Path::new("/usr/bin").join(filename));
        assert_eq!(
            candidates[3],
            home.join(".codex/plugins/.plugin-appserver").join(filename)
        );
    }

    #[test]
    fn plugin_name_rejects_selector_characters() {
        assert!(validate_plugin_name("memory-bank").is_ok());
        assert!(validate_plugin_name("a@b").is_err());
        assert!(validate_plugin_name("../x").is_err());
    }

    #[test]
    fn desktop_builtin_plugins_are_identified() {
        for name in [
            "browser",
            "chrome",
            "unified-computer-use",
            "codex-app-tools",
        ] {
            assert!(is_desktop_builtin(name), "{name} 应识别为桌面内置");
        }
        assert!(!is_desktop_builtin("computer-use"));
        assert!(!is_desktop_builtin("ponytail"));
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

    #[test]
    fn plugin_cli_timeout_and_network_error_detection() {
        assert_eq!(
            plugin_cli_timeout(&["marketplace", "add", "o/r"]).as_secs(),
            PLUGIN_CLI_TIMEOUT_NETWORK_SECS
        );
        assert_eq!(
            plugin_cli_timeout(&["marketplace", "list"]).as_secs(),
            PLUGIN_CLI_TIMEOUT_FAST_SECS
        );
        assert!(looks_like_network_error(
            "fatal: unable to access 'https://github.com/': Failed to connect"
        ));
        assert!(!looks_like_network_error("marketplace already added"));
    }

    #[test]
    fn plugin_timeout_message_matches_operation_tier() {
        let network = plugin_timeout_message(
            &["marketplace", "add", "o/r"],
            Duration::from_secs(PLUGIN_CLI_TIMEOUT_NETWORK_SECS),
        );
        assert!(network.contains("GitHub"));
        let local =
            plugin_timeout_message(&["list"], Duration::from_secs(PLUGIN_CLI_TIMEOUT_FAST_SECS));
        assert!(!local.contains("GitHub"), "本地操作超时不能诊断为网络问题");
        assert!(local.contains("20"));
    }

    /// 管道排水回归测试的子进程入口：父测试以本环境变量拉起当前测试二进制，
    /// 正常跑测试时无此变量，直接通过。
    const TEST_CHILD_MODE_ENV: &str = "CGSWITCH_PLUGINS_TEST_CHILD_MODE";

    #[test]
    fn plugins_test_child_entry() {
        let Some(mode) = std::env::var(TEST_CHILD_MODE_ENV).ok() else {
            return;
        };
        match mode.as_str() {
            // 向 stdout 写 2 MB，远超任何 OS 管道缓冲
            "firehose" => {
                use std::io::Write;
                let chunk = "x".repeat(1024);
                let mut stdout = std::io::stdout().lock();
                for _ in 0..2048 {
                    writeln!(stdout, "{chunk}").ok();
                }
                stdout.flush().ok();
            }
            // 挂住不退出，验证超时 kill 路径
            "stall" => std::thread::sleep(Duration::from_secs(60)),
            _ => {}
        }
        std::process::exit(0);
    }

    fn spawn_test_child(mode: &str) -> std::process::Child {
        std::process::Command::new(std::env::current_exe().unwrap())
            .arg("plugins_test_child_entry")
            .arg("--nocapture")
            .env(TEST_CHILD_MODE_ENV, mode)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap()
    }

    #[test]
    fn wait_child_drains_large_output_without_deadlock() {
        let started = Instant::now();
        let output = wait_child_with_timeout(spawn_test_child("firehose"), Duration::from_secs(15))
            .unwrap()
            .expect("大输出必须靠预排水线程收完，否则子进程写满管道永不退出");
        assert!(output.status.success());
        // 子进程输出 2048 行 × 1025 字节 ≈ 2 MB（测试框架自身会附加少量字节，
        // 故用阈值断言：写满管道若未预排水，只能收到 ~64 KB 残留且走超时路径）
        assert!(
            output.stdout.len() > 2_000_000,
            "应完整收下全部输出，实际 {} 字节",
            output.stdout.len()
        );
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "不应等到超时才返回"
        );
    }

    #[test]
    fn wait_child_kills_stalled_process_on_deadline() {
        let started = Instant::now();
        let outcome =
            wait_child_with_timeout(spawn_test_child("stall"), Duration::from_secs(2)).unwrap();
        assert!(outcome.is_none(), "挂死的子进程应按超时终止");
        assert!(
            started.elapsed() < Duration::from_secs(10),
            "应在超时时间点附近返回"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn scutil_proxy_fields_parse() {
        let text = "<dictionary> {\n  HTTPEnable : 1\n  HTTPPort : 20080\n  HTTPProxy : 127.0.0.1\n  HTTPSEnable : 1\n  HTTPSPort : 20080\n  HTTPSProxy : 127.0.0.1\n}\n";
        assert_eq!(
            scutil_value(text, "HTTPSProxy").as_deref(),
            Some("127.0.0.1")
        );
        assert_eq!(scutil_value(text, "HTTPSPort").as_deref(), Some("20080"));
        assert_eq!(scutil_value(text, "NoSuchKey"), None);
    }

    fn context() -> (tempfile::TempDir, AppContext) {
        let home = tempfile::tempdir().unwrap();
        let paths = crate::paths::from_home(home.path()).unwrap();
        paths.ensure().unwrap();
        let context = AppContext::new(paths).unwrap();
        (home, context)
    }

    #[tokio::test]
    async fn scan_codex_plugin_cache_reads_manifest_and_version() {
        // 直接测底层 cache 扫描函数，避开 list_plugins 的 CLI 探测链。
        // 本机 PATH 装了真 codex CLI 会劫持 list_plugins 走 CLI 路径，与 cache fixture 无关；
        // 这里直调 scan_codex_plugin_cache，本机环境跟它零耦合。
        // fixture 用抽象名（sample-marketplace / sample-plugin / v1.0.0），不撞现实插件。
        let home = tempfile::tempdir().unwrap();
        let codex_home = home.path().join(".codex");
        let cache_dir = codex_home
            .join("plugins")
            .join("cache")
            .join("sample-marketplace")
            .join("sample-plugin")
            .join("v1.0.0")
            .join(".codex-plugin");
        std::fs::create_dir_all(&cache_dir).unwrap();
        std::fs::write(
            cache_dir.join("plugin.json"),
            r#"{"name":"sample-plugin","description":"Fixture plugin"}"#,
        )
        .unwrap();

        let plugins = scan_codex_plugin_cache(&codex_home);
        assert_eq!(plugins.len(), 1);
        let plugin = &plugins[0];
        assert_eq!(plugin.name, "sample-plugin");
        assert_eq!(plugin.marketplace.as_deref(), Some("sample-marketplace"));
        assert_eq!(plugin.version.as_deref(), Some("v1.0.0"));
        assert_eq!(plugin.origin, "codex");
        assert!(plugin.enabled);
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
