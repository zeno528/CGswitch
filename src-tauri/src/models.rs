use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

use crate::auth::codex_oauth::AuthStatus;

/// 供应商类型：官方订阅（ChatGPT）或第三方供应商（Codex 协议）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileKind {
    Official,
    ThirdParty,
}

impl ProfileKind {
    pub fn from_db(raw: &str) -> Option<Self> {
        match raw {
            "official" => Some(Self::Official),
            "third_party" => Some(Self::ThirdParty),
            _ => None,
        }
    }

    pub fn as_db(self) -> &'static str {
        match self {
            Self::Official => "official",
            Self::ThirdParty => "third_party",
        }
    }
}

/// 官方 ChatGPT 配置的固定认证来源；OAuth 账号只能在 OAuth 来源内切换。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthSource {
    Desktop,
    Oauth,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct ProfilePayload {
    #[serde(default)]
    pub model_values: BTreeMap<String, String>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub provider_body: Option<String>,
    /// 内置官方供应商类型（deepseek/minimax/zhipu/chatgpt）；普通捕获的供应商为 None。
    #[serde(default)]
    pub builtin: Option<String>,
    /// 官方配置创建时确定的认证来源；旧数据缺失时由 account_id 兼容推断。
    #[serde(default)]
    pub auth_source: Option<AuthSource>,
    /// 供应商自己保存的完整 config 原文（内置供应商可全量编辑；普通供应商无该字段）。
    #[serde(default)]
    pub raw_config: Option<String>,
    /// 供应商自己保存的 models.json 原文（编辑后随供应商应用写入 ~/.codex）。
    #[serde(default)]
    pub raw_catalog: Option<String>,
    /// Desktop/第三方供应商保存的 auth.json 原文；OAuth 官方配置不吸收 live 快照。
    #[serde(default)]
    pub raw_auth: Option<String>,
    /// 历史快照标记；Some(false) 表示用户明确手动接管认证内容。
    #[serde(default)]
    pub auth_auto_sync: Option<bool>,
    /// 模型提供方的管理后台网址（卡片显示跳转按钮）。
    #[serde(default)]
    pub admin_url: Option<String>,
    /// 供应商级开关：是否在卡片显示并自动刷新余额/用量（默认关，用户自行开启）。
    #[serde(default = "default_false")]
    pub show_balance: bool,
    /// 最近一次从供应商接口获取的模型 ID，供编辑页离线复用。
    #[serde(default)]
    pub fetched_models: Vec<String>,
}

impl ProfilePayload {
    pub fn effective_auth_source(
        &self,
        kind: ProfileKind,
        account_id: Option<&str>,
    ) -> Option<AuthSource> {
        if kind != ProfileKind::Official {
            return None;
        }
        Some(self.auth_source.unwrap_or(if account_id.is_some() {
            AuthSource::Oauth
        } else {
            AuthSource::Desktop
        }))
    }
}

fn default_false() -> bool {
    false
}

/// ~/.codex/config.toml [mcp_servers.*] 的一条服务器配置（建模字段子集；未建模键由 toml_edit 原样保留）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct McpServerSpec {
    pub name: String,
    /// None = 未写入该键（Codex 默认启用）；Some(false) 显式停用。
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(default)]
    pub startup_timeout_sec: Option<i64>,
    #[serde(default)]
    pub tool_timeout_sec: Option<i64>,
    /// STDIO 传输：有 command 无 url。
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Streamable HTTP 传输：有 url 无 command。
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub bearer_token_env_var: Option<String>,
    #[serde(default)]
    pub http_headers: BTreeMap<String, String>,
    #[serde(default)]
    pub env_http_headers: BTreeMap<String, String>,
}

/// MCP 同步预览的一条差异（live = ~/.codex/config.toml，db = 数据库镜像）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpSyncEntryKind {
    /// 仅配置文件有（导入数据库会新增；恢复到配置会被删除）。
    LiveOnly,
    /// 仅数据库有（恢复到配置会加回；导入数据库会被清除）。
    DbOnly,
    /// 两侧都有但内容不同。
    Changed,
}

/// 建模字段的逐项差异（值经 serde_json 序列化，前端直接展示）。
#[derive(Debug, Clone, Serialize)]
pub struct McpSyncFieldDiff {
    pub field: String,
    pub live: serde_json::Value,
    pub db: serde_json::Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpSyncDiffEntry {
    pub name: String,
    pub kind: McpSyncEntryKind,
    pub live_spec: Option<McpServerSpec>,
    pub db_spec: Option<McpServerSpec>,
    /// 两侧的原始 TOML 片段（单侧独有时另一侧为 None），展开明细时展示。
    pub live_toml: Option<String>,
    pub db_toml: Option<String>,
    pub changed_fields: Vec<McpSyncFieldDiff>,
}

#[derive(Debug, Clone, Serialize)]
pub struct McpSyncPreview {
    pub entries: Vec<McpSyncDiffEntry>,
    pub live_count: usize,
    pub db_count: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileSummary {
    pub id: String,
    pub name: String,
    pub kind: ProfileKind,
    /// 官方配置绑定的订阅账号；第三方恒为 None。
    pub account_id: Option<String>,
    pub auth_source: Option<AuthSource>,
    pub model: Option<String>,
    pub provider: Option<String>,
    pub reasoning_effort: Option<String>,
    /// 供应商是否已配置有效 API 密钥（占位符视为未配置）
    pub has_key: bool,
    pub admin_url: Option<String>,
    pub show_balance: bool,
    pub icon: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileBalanceInfo {
    pub currency: String,
    pub total_balance: String,
    pub granted_balance: String,
    pub topped_up_balance: String,
    /// 用量型供应商（如 MiniMax Token Plan）的已用百分比；余额型供应商为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_percent: Option<u32>,
    /// 主用量窗口重置倒计时（如 "2h23m"）；余额型供应商为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_reset: Option<String>,
    /// 主用量窗口重置时间（Unix 毫秒）；余额型供应商为 None。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_reset_at: Option<i64>,
    /// 主用量窗口名称；由接口返回的窗口长度推断。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage_label: Option<String>,
    /// 次用量窗口已用百分比；仅用量型供应商返回。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekly_usage_percent: Option<u32>,
    /// 次用量窗口重置倒计时（如 "5d21h"）；仅用量型供应商返回。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekly_reset: Option<String>,
    /// 次用量窗口重置时间（Unix 毫秒）；仅用量型供应商返回。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekly_reset_at: Option<i64>,
    /// 次用量窗口名称；免费方案可为“30天”。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weekly_label: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileDetail {
    pub id: String,
    pub name: String,
    /// 官方配置绑定的订阅账号；第三方恒为 None。
    pub account_id: Option<String>,
    pub auth_source: Option<AuthSource>,
    /// Desktop 配置自身 auth.json 解析出的登录账号；OAuth 由 account_id 管理。
    pub desktop_login: Option<String>,
    pub icon: Option<String>,
    pub provider: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model_values: std::collections::BTreeMap<String, String>,
    pub config_fragment: String,
    pub raw_config: Option<String>,
    pub catalog_content: Option<String>,
    pub raw_catalog: Option<String>,
    pub raw_auth: Option<String>,
    pub admin_url: Option<String>,
    pub show_balance: bool,
    pub fetched_models: Vec<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Settings {
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default)]
    pub auto_restart: bool,
    #[serde(default)]
    pub autostart_enabled: bool,
    #[serde(default)]
    pub silent_start: bool,
    #[serde(default)]
    pub minimize_to_tray: bool,
    #[serde(default = "default_auto_check_update")]
    pub auto_check_update: bool,
    #[serde(default)]
    pub auto_backup_interval_hours: u64,
    #[serde(default = "default_database_backup_keep_count")]
    pub database_backup_keep_count: u32,
}

fn default_theme() -> String {
    "system".into()
}

/// 界面语言；"system" 表示跟随系统语言。
fn default_language() -> String {
    "system".into()
}

fn default_database_backup_keep_count() -> u32 {
    5
}

fn default_auto_check_update() -> bool {
    true
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            language: default_language(),
            auto_restart: false,
            autostart_enabled: false,
            silent_start: false,
            minimize_to_tray: false,
            auto_check_update: default_auto_check_update(),
            auto_backup_interval_hours: 0,
            database_backup_keep_count: default_database_backup_keep_count(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct PathInfo {
    pub label: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CodexAppStatus {
    pub running: bool,
    pub display_path: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AppState {
    pub profiles: Vec<ProfileSummary>,
    pub active_profile_id: Option<String>,
    pub codex: CodexAppStatus,
    pub settings: Settings,
    pub paths: Vec<PathInfo>,
    pub auth_status: AuthStatus,
    /// 供应商级余额缓存（上次成功查询结果），保证卡片静默显示、切换不闪烁。
    pub balance_cache: std::collections::BTreeMap<String, ProfileBalanceInfo>,
}
