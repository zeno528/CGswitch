use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tokio::sync::Mutex as AsyncMutex;

use crate::auth::codex_oauth::{parse_external_auth_json, ManagedAccount};
use crate::builtin;
use crate::codex::{
    config as codex_config, process as codex_process, window_state as codex_window_state,
};
use crate::database::{profile_summary, Database};
use crate::error::{app_err, AppResult};
use crate::fsutil::{atomic_write, backup_file, prune_backups};
use crate::models::{
    AppState, AuthSource, ChatgptResetCredit, CodexAppStatus, McpDiffEntryAction, McpServerSpec,
    McpSyncDiffEntry, McpSyncEntryKind, McpSyncPreview, PathInfo, ProfileBalanceInfo,
    ProfileDetail, ProfileKind, ProfilePayload, ProfileSummary, Settings,
};
use crate::paths::{now_ms, now_secs, AppPaths};

mod accounts;
mod apply;
mod claude;
mod connections;
mod mcp;
mod mcp_probe;
mod model_fetch;
mod plugin_net;
mod plugins;
pub(crate) mod profile_config;
mod profiles;
mod settings;
mod storage;
pub(crate) mod sync;

pub use claude::{fetch_claude_models, probe_claude_messages_reachable};
pub use connections::{test_provider_connection, ProfileBalance, ProfileConnectionResult};
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
