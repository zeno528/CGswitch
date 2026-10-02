use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tokio::sync::Mutex as AsyncMutex;

use crate::auth::codex_oauth::{parse_external_auth_json, ManagedAccount};
use crate::codex::{
    config as codex_config, process as codex_process, window_state as codex_window_state,
};
use crate::database::{codex_profile_summary, Database};
use crate::error::{app_err, AppResult};
use crate::fsutil::{atomic_write, backup_file, prune_backups};
use crate::models::{
    AppState, AuthSource, ChatgptResetCredit, CodexAppStatus, CodexProfileDetail, CodexProfileKind,
    CodexProfilePayload, CodexProfileSummary, McpDiffEntryAction, McpServerSpec, McpSyncDiffEntry,
    McpSyncEntryKind, McpSyncPreview, PathInfo, ProfileBalanceInfo, Settings,
};
use crate::paths::{now_ms, now_secs, AppPaths};

mod claude;
mod codex_accounts;
mod codex_apply;
pub(crate) mod codex_profile_config;
mod codex_profiles;
mod connections;
mod mcp;
mod mcp_probe;
mod model_fetch;
mod plugin_net;
mod plugins;
mod settings;
mod storage;
pub(crate) mod sync;

pub use claude::{fetch_claude_models, probe_claude_messages_reachable};
pub use connections::{test_provider_connection, CodexProfileConnectionResult, ProfileBalance};
pub use model_fetch::fetch_models;
pub use plugins::{
    detect_system_proxy, MarketplacePlugin, PluginCandidate, PluginMarketplace, PluginPreview,
    PluginSkill, PluginSummary, PluginUpdate, SkillCandidate, SkillSummary, SkillTool,
};
pub use storage::DatabaseBackupInfo;

#[derive(Clone, Debug)]
pub struct AppContext {
    database: Arc<Database>,
    paths: AppPaths,
    operation: Arc<Mutex<()>>,
    /// 认证激活需要等待 OAuth 刷新，必须从开始到 live auth 写入保持顺序。
    activation: Arc<AsyncMutex<()>>,
}

impl AppContext {
    pub fn new(paths: AppPaths) -> AppResult<Self> {
        let database = Arc::new(Database::open(&paths)?);
        Ok(Self::new_with_database(paths, database))
    }

    pub fn new_with_database(paths: AppPaths, database: Arc<Database>) -> Self {
        Self {
            database,
            paths,
            operation: Arc::new(Mutex::new(())),
            activation: Arc::new(AsyncMutex::new(())),
        }
    }

    pub fn get_state(&self) -> AppResult<AppState> {
        // 被动回写统一走时机层（StateRefresh 覆盖启动预发/窗口激活/页内刷新）；
        // 已解析的 live 文档直接复用，不在启动路径二次读盘；
        // 操作锁被切换/应用占用时本轮跳过，下一轮激活自愈
        let live = self.live_document();
        sync::registry().harvest_passive(
            self,
            &sync::SyncTrigger::StateRefresh,
            sync::SyncMaterial {
                codex_document: live.as_ref(),
            },
        );
        let settings = self.settings()?;
        let profiles = self.database.codex_profiles()?;
        // 激活状态只来自手动应用（显式状态或应用事件），不做 live 配置推断，
        // 避免“添加供应商”被误判成“正在使用”。
        let active_codex_profile_id = match self.active_profile_state()? {
            Some(id) if profiles.iter().any(|profile| profile.id == id) => Some(id),
            _ => match self.database.codex_latest_applied_profile()? {
                Some(id) if profiles.iter().any(|profile| profile.id == id) => Some(id),
                _ => None,
            },
        };
        let live_payload = live
            .as_ref()
            .and_then(|document| codex_config::capture_from_document(document).ok());
        // 配置卡片套餐标识：OAuth 绑定账号取库内套餐，Desktop 取自身数据库认证快照的
        // 套餐（不读 live auth.json：切换后该文件是别账号的认证，会把徽标带错）；
        // 账号列表一次查齐避免逐卡片查询
        let account_plans: std::collections::HashMap<String, String> = self
            .database
            .accounts()?
            .into_iter()
            .filter_map(|account| {
                let id = account.id;
                account.plan_type.map(|plan| (id, plan))
            })
            .collect();
        // 应用安装路径固定 + 自动识别，不支持手动覆盖
        let process_ids = codex_process::find_process_ids(None);
        let (display_path, source) = codex_process::codex_display_path(None);
        let balance_cache = self.load_balance_cache();

        Ok(AppState {
            codex_profiles: profiles
                .iter()
                .map(|profile| {
                    let mut stored = profile.clone();
                    // 激活中的供应商：标签读取当前配置文件状态；其余供应商读取数据库最新字段
                    if Some(&stored.id) == active_codex_profile_id.as_ref() {
                        if let Some(live) = &live_payload {
                            let mut live = live.clone();
                            // 供应商元数据不在 live 配置里，覆盖时保留。
                            live.description = stored.payload.description.clone();
                            live.admin_url = stored.payload.admin_url.clone();
                            live.show_balance = stored.payload.show_balance;
                            live.fetched_models = stored.payload.fetched_models.clone();
                            stored.payload = live;
                        }
                    }
                    let mut summary = codex_profile_summary(&stored);
                    if summary.auth_source == Some(AuthSource::Desktop) {
                        summary.auth_account_id = profile
                            .payload
                            .raw_auth
                            .as_deref()
                            .and_then(parse_external_auth_json)
                            .map(|auth| auth.account_id);
                    }
                    summary.plan_type = match summary.auth_source {
                        Some(AuthSource::Oauth) => summary
                            .account_id
                            .as_deref()
                            .and_then(|id| account_plans.get(id).cloned()),
                        // 取覆盖前 DB 行的快照：active 卡的 payload 已被 live 覆盖，raw_auth 为空
                        Some(AuthSource::Desktop) => profile
                            .payload
                            .raw_auth
                            .as_deref()
                            .and_then(parse_external_auth_json)
                            .and_then(|auth| auth.plan_type),
                        None => None,
                    };
                    summary
                })
                .collect::<Vec<CodexProfileSummary>>(),
            active_codex_profile_id,
            active_claude_profile_id: self.database.active_claude_profile()?,
            codex: CodexAppStatus {
                running: !process_ids.is_empty(),
                display_path,
                source,
            },
            settings,
            paths: self.path_info(),
            auth_status: Default::default(),
            balance_cache,
        })
    }

    /// 共享改名：按 `tool` 分发到对应客户端的配置表。
    pub fn rename_profile(&self, id: &str, name: &str, tool: SkillTool) -> AppResult<()> {
        let (previous_name, source) = match tool {
            SkillTool::Codex => (self.database.codex_profile(id)?.name, "codex"),
            SkillTool::Claude => (self.database.claude_profile(id)?.name, "claude"),
        };
        let name = validated_name(name)?;
        self.database
            .rename_profile(id, &name, &now_ms().to_string(), tool)?;
        tauri_plugin_log::log::info!(
            "[provider.profile.rename] source={source} profile_id={id} profile_name={previous_name:?} new_name={name:?} outcome=success msg=\"已重命名配置\""
        );
        Ok(())
    }
}

fn read_optional_text(path: &Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .filter(|text| text.len() <= 512 * 1024)
}

pub(super) fn normalize_auth_override(text: Option<&str>) -> Option<String> {
    let text = text?.trim();
    if text.is_empty() {
        return None;
    }
    let is_empty_object = serde_json::from_str::<serde_json::Value>(text)
        .ok()
        .and_then(|value| value.as_object().map(|object| object.is_empty()))
        .unwrap_or(false);
    (!is_empty_object).then(|| text.to_string())
}

/// 供应商名称的共享规则（Codex 与 Claude 的创建/编辑/改名共用）。
fn validated_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 50 {
        return Err(app_err!("供应商名称长度必须在 1 到 50 个字符之间"));
    }
    Ok(name.to_string())
}

/// 供应商描述的共享规则。
fn validated_description(description: Option<&str>) -> AppResult<Option<String>> {
    let description = description.map(str::trim).filter(|text| !text.is_empty());
    if description.is_some_and(|text| text.chars().count() > 200) {
        return Err(app_err!("供应商描述不能超过 200 个字符"));
    }
    Ok(description.map(str::to_string))
}

/// 供应商图标 id 的共享规则（icons.ts 收集的 provider 图标 id）。
fn validated_icon(icon: Option<&str>) -> AppResult<Option<String>> {
    icon.map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| {
            if value.len() > 40
                || !value
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            {
                return Err(app_err!("无效的图标标识"));
            }
            Ok(value.to_string())
        })
        .transpose()
}

/// 复制命名的共享规则（Codex 与 Claude 的 duplicate 共用）：base 加 ` copy` 后缀，
/// 撞名（忽略 ASCII 大小写）追加序号，从 `copy 2` 起计；base 由调用方先截 45 字符。
pub(super) fn unique_copy_name(base: &str, is_taken: impl Fn(&str) -> bool) -> String {
    let mut candidate = format!("{base} copy");
    let mut counter = 2;
    while is_taken(&candidate) {
        candidate = format!("{base} copy {counter}");
        counter += 1;
    }
    candidate
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
