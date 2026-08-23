use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter};

use crate::auth::codex_oauth::{parse_external_auth_json, ManagedAccount};
use crate::builtin;
use crate::codex::{config as codex_config, process as codex_process};
use crate::database::{profile_summary, Database};
use crate::error::{app_err, AppResult};
use crate::fsutil::{atomic_write, backup_file, prune_backups};
use crate::models::{
    AppState, CodexAppStatus, McpServerSpec, McpSyncDiffEntry, McpSyncEntryKind, McpSyncFieldDiff,
    McpSyncPreview, PathInfo, ProfileBalanceInfo, ProfileDetail, ProfileKind, ProfilePayload,
    ProfileSummary, Settings,
};
use crate::paths::{now_ms, AppPaths};

mod accounts;
mod apply;
mod connections;
mod mcp;
mod plugin_net;
mod plugins;
mod profile_config;
mod profiles;
mod settings;
mod storage;

pub use connections::{test_provider_connection, ProfileBalance, ProfileConnectionResult};
pub use plugins::{
    MarketplacePlugin, PluginCandidate, PluginMarketplace, PluginPreview, PluginSkill,
    PluginSummary, PluginUpdate, SkillCandidate, SkillSummary,
};
pub use storage::DatabaseBackupInfo;

#[derive(Debug)]
pub struct AppContext {
    database: Arc<Database>,
    paths: AppPaths,
    operation: Mutex<()>,
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
            operation: Mutex::new(()),
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

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
