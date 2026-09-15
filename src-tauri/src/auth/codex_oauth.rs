//! ChatGPT 官方订阅的 OAuth Device Code 认证（对齐官方 Codex CLI 的登录流程）。
//!
//! 1. 向 OpenAI 申请设备码，展示 user_code 与验证网址，用户在浏览器完成授权；
//! 2. 轮询获取 authorization_code + code_verifier，再换取
//!    access_token / refresh_token / id_token；
//! 3. 账号持久化（只存 refresh_token 与账号标识），access_token 内存缓存、到期前自动刷新。
//!
//! 认证一次后账号常驻，后续添加 ChatGPT 供应商无需重复认证。

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::{SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, RwLock};

use crate::database::{Database, StoredAccount};
use crate::error::AppResult;

/// OpenAI OAuth 客户端 ID（与官方 Codex CLI 相同）
const CODEX_CLIENT_ID: &str = "app_EMoamEEZ73f0CkXaXp7hrann";
const DEVICE_AUTH_USERCODE_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/usercode";
const DEVICE_AUTH_TOKEN_URL: &str = "https://auth.openai.com/api/accounts/deviceauth/token";
const OAUTH_TOKEN_URL: &str = "https://auth.openai.com/oauth/token";
const DEVICE_VERIFICATION_URL: &str = "https://auth.openai.com/codex/device";
const DEVICE_REDIRECT_URI: &str = "https://auth.openai.com/deviceauth/callback";
const TOKEN_REFRESH_BUFFER_MS: i64 = 60_000;
const DEVICE_CODE_DEFAULT_EXPIRES_IN: u64 = 900;
const CODEX_USER_AGENT: &str = "cgswitch-codex-oauth";
const REGION_BLOCKED_MARKER: &str = "unsupported_country_region_territory";

#[derive(Debug, thiserror::Error)]
pub enum CodexOAuthError {
    #[error("等待用户授权中")]
    AuthorizationPending,
    #[error("用户拒绝授权")]
    AccessDenied,
    #[error("设备码已过期")]
    ExpiredToken,
    #[error("OAuth 请求失败: {0}")]
    RequestFailed(String),
    #[error("Refresh Token 失效或已过期")]
    RefreshTokenInvalid,
    #[error("网络错误: {0}")]
    NetworkError(String),
    #[error("解析错误: {0}")]
    ParseError(String),
    #[error("账号不存在: {0}")]
    AccountNotFound(String),
    #[error("IO 错误: {0}")]
    IoError(String),
}

impl From<reqwest::Error> for CodexOAuthError {
    fn from(error: reqwest::Error) -> Self {
        CodexOAuthError::NetworkError(error.to_string())
    }
}

/// 返回给前端的设备码信息
#[derive(Debug, Clone, Serialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

/// 已认证账号摘要
#[derive(Debug, Clone, Serialize)]
pub struct ManagedAccount {
    pub id: String,
    pub login: String,
    pub authenticated_at: i64,
    pub is_default: bool,
}

/// 认证状态摘要
#[derive(Debug, Clone, Serialize, Default)]
pub struct AuthStatus {
    pub authenticated: bool,
    pub default_account_id: Option<String>,
    pub accounts: Vec<ManagedAccount>,
    /// Codex CLI 官方认证（~/.codex/auth.json），只识别不导入数据库。
    pub external: Option<ManagedAccount>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawDeviceCodeResponse {
    device_auth_id: String,
    user_code: String,
    #[serde(default)]
    interval: Option<serde_json::Value>,
    #[serde(default)]
    expires_in: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
struct RawDevicePollSuccess {
    authorization_code: String,
    code_verifier: String,
}

#[derive(Debug, Clone, Deserialize)]
struct OAuthTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    #[serde(default)]
    id_token: Option<String>,
    #[serde(default)]
    expires_in: Option<i64>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct IdTokenClaims {
    /// 跨刷新稳定的用户身份：同一 workspace 的不同用户 sub 不同
    #[serde(default)]
    sub: Option<String>,
    #[serde(default)]
    chatgpt_account_id: Option<String>,
    #[serde(default)]
    email: Option<String>,
    #[serde(default)]
    organizations: Vec<OrgClaim>,
    #[serde(default, rename = "https://api.openai.com/auth")]
    openai_auth: Option<OpenAiAuthClaim>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct OrgClaim {
    #[serde(default)]
    id: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
struct OpenAiAuthClaim {
    #[serde(default)]
    chatgpt_account_id: Option<String>,
}

/// 内存缓存的 access_token
#[derive(Debug, Clone)]
struct CachedAccessToken {
    token: String,
    expires_at_ms: i64,
}

impl CachedAccessToken {
    fn is_expiring_soon(&self) -> bool {
        self.expires_at_ms - now_ms() < TOKEN_REFRESH_BUFFER_MS
    }
}

/// 进行中的设备码流程
#[derive(Debug, Clone)]
struct PendingDeviceCode {
    user_code: String,
    expires_at_ms: i64,
}

/// 持久化的账号数据（refresh_token/id_token + 上次生成的 auth.json 缓存，access_token 不落盘）
#[derive(Debug, Clone)]
struct CodexAccountData {
    /// 本地主键：存量行是 workspace ID，新行由登录流程生成（acc-<毫秒>-<自增>）
    account_id: String,
    email: Option<String>,
    id_token: Option<String>,
    refresh_token: String,
    auth_json: Option<String>,
    authenticated_at: i64,
    /// ChatGPT workspace ID（出站语义），存量行迁移时回填为行 id
    chatgpt_account_id: Option<String>,
    /// id_token 的 sub：判重与 live auth.json 所有权校验
    user_identity: Option<String>,
}

impl CodexAccountData {
    /// 出站用的 workspace ID；未回填的旧行回退行 id
    fn workspace_id(&self) -> Option<String> {
        self.chatgpt_account_id
            .clone()
            .or_else(|| Some(self.account_id.clone()))
    }
}

impl From<StoredAccount> for CodexAccountData {
    fn from(account: StoredAccount) -> Self {
        Self {
            account_id: account.id,
            email: account.email,
            id_token: account.id_token,
            refresh_token: account.refresh_token,
            auth_json: account.auth_json,
            authenticated_at: account.authenticated_at,
            chatgpt_account_id: account.chatgpt_account_id,
            user_identity: account.user_identity,
        }
    }
}

impl From<&CodexAccountData> for StoredAccount {
    fn from(account: &CodexAccountData) -> Self {
        Self {
            id: account.account_id.clone(),
            email: account.email.clone(),
            id_token: account.id_token.clone(),
            refresh_token: account.refresh_token.clone(),
            auth_json: account.auth_json.clone(),
            authenticated_at: account.authenticated_at,
            chatgpt_account_id: account.chatgpt_account_id.clone(),
            user_identity: account.user_identity.clone(),
        }
    }
}

/// 账号本地主键的进程内自增后缀：同一毫秒内登录多个账号也不会撞主键
static ACCOUNT_ID_SEQ: AtomicU64 = AtomicU64::new(0);

/// 多账号认证管理器
pub struct CodexOAuthManager {
    client: Mutex<reqwest::Client>,
    accounts: Arc<RwLock<HashMap<String, CodexAccountData>>>,
    default_account_id: Arc<RwLock<Option<String>>>,
    access_tokens: Arc<RwLock<HashMap<String, CachedAccessToken>>>,
    refresh_locks: Arc<RwLock<HashMap<String, Arc<Mutex<()>>>>>,
    pending_device_codes: Arc<RwLock<HashMap<String, PendingDeviceCode>>>,
    database: Arc<Database>,
}

impl CodexOAuthManager {
    fn build_client() -> reqwest::Client {
        reqwest::Client::builder()
            .user_agent(CODEX_USER_AGENT)
            .build()
            .expect("创建 HTTP 客户端失败")
    }

    /// 发送请求；响应为地区拦截 403 时，重建客户端（重新读取系统代理）后重试一次。
    /// 正常路径复用缓存客户端，不影响性能。
    async fn request_with_proxy_retry(
        &self,
        operation: &str,
        context: &str,
        make: impl Fn(reqwest::Client) -> reqwest::RequestBuilder,
    ) -> Result<(reqwest::StatusCode, String), CodexOAuthError> {
        let mut retried = false;
        loop {
            let retry_prefix = if retried { " 代理重试" } else { " " };
            let client = self.client.lock().await.clone();
            let response = make(client).send().await.map_err(|error| {
                tauri_plugin_log::log::warn!(
                    "[auth] {operation}{retry_prefix}网络请求失败 [{context}]: {error}"
                );
                CodexOAuthError::from(error)
            })?;
            let status = response.status();
            let text = response.text().await.map_err(|error| {
                tauri_plugin_log::log::warn!(
                    "[auth] {operation}{retry_prefix}响应读取失败 [{context}] HTTP {status}: {error}"
                );
                CodexOAuthError::from(error)
            })?;
            if !retried
                && status == reqwest::StatusCode::FORBIDDEN
                && text.contains(REGION_BLOCKED_MARKER)
            {
                *self.client.lock().await = Self::build_client();
                retried = true;
                continue;
            }
            return Ok((status, text));
        }
    }

    pub fn new(database: Arc<Database>) -> Self {
        let manager = Self {
            client: Mutex::new(Self::build_client()),
            accounts: Arc::new(RwLock::new(HashMap::new())),
            default_account_id: Arc::new(RwLock::new(None)),
            access_tokens: Arc::new(RwLock::new(HashMap::new())),
            refresh_locks: Arc::new(RwLock::new(HashMap::new())),
            pending_device_codes: Arc::new(RwLock::new(HashMap::new())),
            database,
        };
        if let Err(error) = manager.load_accounts() {
            tauri_plugin_log::log::warn!("[auth] 加载认证账号失败: {error}");
        }
        manager
    }

    /// 数据库恢复/导入后，重新从 SQLite 加载账号（不再触发旧 JSON 导入）。
    pub fn reload_from_database(&self) -> AppResult<()> {
        self.load_accounts()
    }

    // ==================== 设备码流程 ====================

    /// 启动设备码流程，返回需要展示给用户的 user_code 与验证网址
    pub async fn start_device_flow(&self) -> Result<DeviceCodeResponse, CodexOAuthError> {
        let (status, text) = self
            .request_with_proxy_retry("设备码申请", "login", |client| {
                client
                    .post(DEVICE_AUTH_USERCODE_URL)
                    .header("Content-Type", "application/json")
                    .json(&serde_json::json!({ "client_id": CODEX_CLIENT_ID }))
            })
            .await?;
        if !status.is_success() {
            tauri_plugin_log::log::warn!("[auth] 设备码申请失败 [login]: HTTP {status}");
            return Err(CodexOAuthError::RequestFailed(format!(
                "设备码请求失败: {status} - {text}"
            )));
        }
        let device: RawDeviceCodeResponse = serde_json::from_str(&text).map_err(|error| {
            tauri_plugin_log::log::warn!("[auth] 设备码响应解析失败 [login]: {error}");
            CodexOAuthError::ParseError(error.to_string())
        })?;

        let interval = parse_interval(device.interval.as_ref());
        let expires_in = device.expires_in.unwrap_or(DEVICE_CODE_DEFAULT_EXPIRES_IN);
        let expires_at_ms = now_ms() + expires_in as i64 * 1000;

        {
            let mut pending = self.pending_device_codes.write().await;
            let now = now_ms();
            pending.retain(|_, entry| entry.expires_at_ms > now);
            pending.insert(
                device.device_auth_id.clone(),
                PendingDeviceCode {
                    user_code: device.user_code.clone(),
                    expires_at_ms,
                },
            );
        }

        Ok(DeviceCodeResponse {
            device_code: device.device_auth_id,
            user_code: device.user_code,
            verification_uri: DEVICE_VERIFICATION_URL.to_string(),
            expires_in,
            interval,
        })
    }

    /// 轮询设备码状态，用户尚未授权时返回 `Ok(None)`
    pub async fn poll_for_token(
        &self,
        device_code: &str,
    ) -> Result<Option<ManagedAccount>, CodexOAuthError> {
        let entry = self
            .pending_device_codes
            .read()
            .await
            .get(device_code)
            .cloned()
            .ok_or_else(|| {
                CodexOAuthError::RequestFailed("未找到对应的用户码，请重新启动登录流程".to_string())
            })?;
        if entry.expires_at_ms <= now_ms() {
            self.pending_device_codes.write().await.remove(device_code);
            return Err(CodexOAuthError::ExpiredToken);
        }

        let (status, text) = self
            .request_with_proxy_retry("设备码轮询", "login", |client| {
                client
                    .post(DEVICE_AUTH_TOKEN_URL)
                    .header("Content-Type", "application/json")
                    .json(&serde_json::json!({
                        "device_auth_id": device_code,
                        "user_code": entry.user_code,
                    }))
            })
            .await?;
        if status == reqwest::StatusCode::FORBIDDEN || status == reqwest::StatusCode::NOT_FOUND {
            if text.contains(REGION_BLOCKED_MARKER) {
                tauri_plugin_log::log::warn!(
                    "[auth] 设备码轮询被地区限制拦截 [login] HTTP {status}"
                );
                return Err(CodexOAuthError::RequestFailed(format!(
                    "设备码轮询失败: {status} - {text}"
                )));
            }
            return Err(CodexOAuthError::AuthorizationPending);
        }
        if status == reqwest::StatusCode::GONE {
            self.pending_device_codes.write().await.remove(device_code);
            return Err(CodexOAuthError::ExpiredToken);
        }
        if !status.is_success() {
            tauri_plugin_log::log::warn!("[auth] 设备码轮询失败 [login]: HTTP {status}");
            return Err(CodexOAuthError::RequestFailed(format!(
                "设备码轮询失败: {status} - {text}"
            )));
        }

        let success: RawDevicePollSuccess = serde_json::from_str(&text).map_err(|error| {
            tauri_plugin_log::log::warn!("[auth] 设备码轮询响应解析失败 [login]: {error}");
            CodexOAuthError::ParseError(error.to_string())
        })?;
        let tokens = self
            .exchange_code_for_tokens(&success.authorization_code, &success.code_verifier)
            .await?;
        self.pending_device_codes.write().await.remove(device_code);

        let refresh_token = tokens.refresh_token.clone().ok_or_else(|| {
            tauri_plugin_log::log::warn!("[auth] 设备码登录响应缺少 refresh_token [login]");
            CodexOAuthError::RequestFailed("响应缺少 refresh_token".to_string())
        })?;
        let (chatgpt_account_id, email) = extract_identity_from_tokens(&tokens);
        let chatgpt_account_id = chatgpt_account_id.ok_or_else(|| {
            tauri_plugin_log::log::warn!("[auth] Token 响应缺少 ChatGPT 账号标识 [login]");
            CodexOAuthError::ParseError("无法从 token 中提取账号标识".to_string())
        })?;

        let account = self
            .add_account_internal(
                chatgpt_account_id,
                refresh_token,
                email,
                tokens.id_token.clone(),
            )
            .await?;
        // 登录响应自带的 access_token 按"本地行 id"入缓存（行 id 与 workspace 解耦后两者不同）
        self.access_tokens.write().await.insert(
            account.id.clone(),
            CachedAccessToken {
                token: tokens.access_token.clone(),
                expires_at_ms: compute_expires_at_ms(tokens.expires_in),
            },
        );
        Ok(Some(account))
    }

    async fn exchange_code_for_tokens(
        &self,
        code: &str,
        code_verifier: &str,
    ) -> Result<OAuthTokenResponse, CodexOAuthError> {
        let (status, text) = self
            .request_with_proxy_retry("授权码换 Token", "login", |client| {
                client
                    .post(OAUTH_TOKEN_URL)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .form(&[
                        ("grant_type", "authorization_code"),
                        ("code", code),
                        ("redirect_uri", DEVICE_REDIRECT_URI),
                        ("client_id", CODEX_CLIENT_ID),
                        ("code_verifier", code_verifier),
                    ])
            })
            .await?;
        if !status.is_success() {
            tauri_plugin_log::log::warn!("[auth] 换取 Token 失败 [login]: HTTP {status}");
            return Err(CodexOAuthError::RequestFailed(format!(
                "换取 Token 失败: {status} - {text}"
            )));
        }
        serde_json::from_str(&text).map_err(|error| {
            tauri_plugin_log::log::warn!("[auth] Token 响应解析失败 [login]: {error}");
            CodexOAuthError::ParseError(error.to_string())
        })
    }

    async fn refresh_with_token(
        &self,
        account_id: &str,
        refresh_token: &str,
    ) -> Result<OAuthTokenResponse, CodexOAuthError> {
        let (status, text) = self
            .request_with_proxy_retry("Token 刷新", account_id, |client| {
                client
                    .post(OAUTH_TOKEN_URL)
                    .header("Content-Type", "application/x-www-form-urlencoded")
                    .form(&[
                        ("grant_type", "refresh_token"),
                        ("refresh_token", refresh_token),
                        ("client_id", CODEX_CLIENT_ID),
                        ("scope", "openid profile email"),
                    ])
            })
            .await?;
        if text.contains(REGION_BLOCKED_MARKER) {
            tauri_plugin_log::log::warn!(
                "[auth] Token 刷新被地区限制拦截 [{account_id}] HTTP {status}"
            );
            return Err(CodexOAuthError::RequestFailed(format!(
                "刷新 Token 失败: {status} - {text}"
            )));
        }
        if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
            // 服务端吊销/拒绝（refresh_token_invalidated）：掉登录的唯一信号源，必须留痕
            tauri_plugin_log::log::warn!(
                "[auth] refresh_token 被服务端拒绝 [{account_id}] (HTTP {status})，该账号需要重新登录"
            );
            return Err(CodexOAuthError::RefreshTokenInvalid);
        }
        if !status.is_success() {
            tauri_plugin_log::log::warn!("[auth] token 刷新请求失败 [{account_id}]: HTTP {status}");
            return Err(CodexOAuthError::RequestFailed(format!(
                "刷新 Token 失败: {status} - {text}"
            )));
        }
        let tokens = serde_json::from_str::<OAuthTokenResponse>(&text).map_err(|error| {
            tauri_plugin_log::log::warn!("[auth] token 刷新响应解析失败 [{account_id}]: {error}");
            CodexOAuthError::ParseError(error.to_string())
        })?;
        tauri_plugin_log::log::info!(
            "[auth] token 刷新成功，新 access_token 有效期约 {} 秒",
            tokens.expires_in.unwrap_or(0)
        );
        Ok(tokens)
    }

    // ==================== Token 获取（含自动刷新） ====================

    /// 获取账号的有效 access_token，临近过期时自动刷新
    pub async fn get_valid_token_for_account(
        &self,
        account_id: &str,
    ) -> Result<String, CodexOAuthError> {
        let refresh_lock = self.get_refresh_lock(account_id).await;
        let _guard = refresh_lock.lock().await;
        self.get_valid_token_for_account_locked(account_id).await
    }

    async fn get_valid_token_for_account_locked(
        &self,
        account_id: &str,
    ) -> Result<String, CodexOAuthError> {
        if let Some(cached) = self.access_tokens.read().await.get(account_id) {
            if !cached.is_expiring_soon() {
                return Ok(cached.token.clone());
            }
        }

        let refresh_token = {
            let accounts = self.accounts.read().await;
            accounts
                .get(account_id)
                .map(|account| account.refresh_token.clone())
                .ok_or_else(|| {
                    tauri_plugin_log::log::warn!("[auth] Token 刷新找不到托管账号 [{account_id}]");
                    CodexOAuthError::AccountNotFound(account_id.to_string())
                })?
        };
        let new_tokens = self.refresh_with_token(account_id, &refresh_token).await?;

        let new_refresh = new_tokens.refresh_token.clone();
        let new_id_token = new_tokens.id_token.clone();
        if new_refresh.is_some() || new_id_token.is_some() {
            let mut accounts = self.accounts.write().await;
            if let Some(account) = accounts.get_mut(account_id) {
                let mut changed = false;
                if let Some(token) = new_refresh {
                    if account.refresh_token != token {
                        account.refresh_token = token;
                        changed = true;
                    }
                }
                if let Some(token) = new_id_token {
                    if account.id_token.as_deref() != Some(token.as_str()) {
                        account.id_token = Some(token);
                        changed = true;
                    }
                }
                if changed {
                    // refresh_token 轮换落库是后续离线复用 auth.json 的依据，必须留痕
                    self.save_account(account)?;
                    tauri_plugin_log::log::info!(
                        "[auth] 账号 {account_id} 凭证已轮换并持久化到数据库"
                    );
                }
            }
        }

        self.access_tokens.write().await.insert(
            account_id.to_string(),
            CachedAccessToken {
                token: new_tokens.access_token.clone(),
                expires_at_ms: compute_expires_at_ms(new_tokens.expires_in),
            },
        );
        Ok(new_tokens.access_token)
    }

    /// 生成官方 Codex CLI 的 auth.json 内容（ChatGPT 订阅登录格式）。
    pub async fn codex_auth_json(&self, account_id: &str) -> Result<String, CodexOAuthError> {
        let refresh_lock = self.get_refresh_lock(account_id).await;
        let _guard = refresh_lock.lock().await;
        self.codex_auth_json_locked(account_id).await
    }

    async fn codex_auth_json_locked(&self, account_id: &str) -> Result<String, CodexOAuthError> {
        let access_token = self.get_valid_token_for_account_locked(account_id).await?;
        let (refresh_token, id_token, chatgpt_account_id) = {
            let accounts = self.accounts.read().await;
            let account = accounts
                .get(account_id)
                .ok_or_else(|| CodexOAuthError::AccountNotFound(account_id.to_string()))?;
            (
                account.refresh_token.clone(),
                account.id_token.clone(),
                account.workspace_id(),
            )
        };
        let id_token = id_token.ok_or_else(|| {
            CodexOAuthError::RequestFailed("账号缺少 id_token，请重新登录".to_string())
        })?;
        // tokens.account_id 必须是 ChatGPT workspace ID（Codex CLI 出站语义），不是本地行 id
        let auth = serde_json::json!({
            "auth_mode": "chatgpt",
            "OPENAI_API_KEY": null,
            "tokens": {
                "id_token": id_token,
                "access_token": access_token,
                "refresh_token": refresh_token,
                "account_id": chatgpt_account_id.unwrap_or_else(|| account_id.to_string()),
            },
            "last_refresh": Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
        });
        let text = serde_json::to_string_pretty(&auth)
            .map_err(|error| CodexOAuthError::ParseError(error.to_string()))?;
        // 缓存本次生成的 auth.json：后续切换配置可离线复用，不发网络请求刷新 token
        {
            let mut accounts = self.accounts.write().await;
            if let Some(account) = accounts.get_mut(account_id) {
                if account.auth_json.as_deref() != Some(text.as_str()) {
                    account.auth_json = Some(text.clone());
                    if let Err(error) = self.save_account(account) {
                        tauri_plugin_log::log::warn!("[auth] 缓存 auth.json 失败: {error}");
                    }
                }
            }
        }
        Ok(text)
    }

    /// 强制刷新账号的 access_token 后生成 auth.json，用于认证失败后的重试。
    pub async fn refresh_codex_auth_json(
        &self,
        account_id: &str,
    ) -> Result<String, CodexOAuthError> {
        let refresh_lock = self.get_refresh_lock(account_id).await;
        let _guard = refresh_lock.lock().await;
        self.access_tokens.write().await.remove(account_id);
        self.codex_auth_json_locked(account_id).await
    }

    /// 读取缓存的 auth.json（离线切换配置用，不触发 token 刷新）。
    pub async fn cached_auth_json(&self, account_id: &str) -> Option<String> {
        let accounts = self.accounts.read().await;
        accounts
            .get(account_id)
            .and_then(|account| account.auth_json.clone())
    }

    /// 把 Codex 运行中刷新过的同账号 auth.json 同步回 OAuth 账号。
    /// 只接受已在 CGswitch 管理中的账号，避免把桌面登录误导入为新账号。
    /// 归属判定用 (workspace, 用户 sub) 双匹配：同 workspace 多账号时绝不串号。
    pub async fn sync_external_auth_json(&self, text: &str) -> Result<bool, CodexOAuthError> {
        let Some(auth) = parse_external_auth_json(text) else {
            return Ok(false);
        };
        let Some(refresh_token) = auth.refresh_token.clone() else {
            return Ok(false);
        };
        // 纯跟随登录（没有任何托管账号）时归属不到是常态，降为 debug 避免每次
        // 同步都刷警告；只有「有托管账号但归属失败」才是「切完掉登录」的前兆
        if self.accounts.read().await.is_empty() {
            tauri_plugin_log::log::debug!("[auth] 无托管账号，跳过 live auth.json 归属同步");
            return Ok(false);
        }
        let Some(row_id) = self.resolve_external_auth_owner(&auth).await else {
            // Codex 刷新了 live auth.json 但归属不到托管账号：后续切配置会写回旧
            // refresh_token，正是「切完掉登录」的前兆，必须留痕
            tauri_plugin_log::log::warn!(
                "[auth] live auth.json 已被外部刷新，但未能归属任何托管账号，跳过同步"
            );
            return Ok(false);
        };
        let refresh_lock = self.get_refresh_lock(&row_id).await;
        let _guard = refresh_lock.lock().await;
        let updated = {
            let mut accounts = self.accounts.write().await;
            let Some(account) = accounts.get_mut(&row_id) else {
                return Ok(false);
            };
            let mut changed = false;
            if account.refresh_token != refresh_token {
                account.refresh_token = refresh_token;
                changed = true;
            }
            if let Some(id_token) = auth.id_token.clone() {
                if account.id_token.as_deref() != Some(id_token.as_str()) {
                    account.id_token = Some(id_token);
                    changed = true;
                }
            }
            if let Some(email) = auth.email.clone() {
                if account.email.as_deref() != Some(email.as_str()) {
                    account.email = Some(email);
                    changed = true;
                }
            }
            // 无身份记录的旧行吸收 live 凭证证明的用户身份（自愈）
            if account.user_identity.is_none() {
                account.user_identity = auth.user_identity.clone();
            }
            if account.auth_json.as_deref() != Some(text) {
                account.auth_json = Some(text.to_string());
                changed = true;
            }
            changed.then(|| account.clone())
        };
        let Some(account) = updated else {
            return Ok(false);
        };
        // 外部 auth.json 没有可靠的 expires_in，不能把它伪装成内存有效 token；
        // 下一次生成 auth.json 时必须按数据库里的 refresh_token 重新验证。
        self.access_tokens.write().await.remove(&row_id);
        self.save_account(&account).map_err(|error| {
            tauri_plugin_log::log::warn!("[auth] 同步外部 auth.json 落库失败 [{row_id}]: {error}");
            error
        })?;
        tauri_plugin_log::log::info!("[auth] 已把外部刷新的 live auth.json 同步回账号 {row_id}");
        Ok(true)
    }

    /// 判定 live auth.json 属于哪一行托管账号：
    /// 精确匹配 (workspace, sub)；旧行缺身份时以 email 辅助认领；缺 sub 的外部认证
    /// 只在 workspace 唯一归属时认领（多行宁可放弃，避免把 A 的凭证写进 B 的行）。
    async fn resolve_external_auth_owner(&self, auth: &ExternalCodexAuth) -> Option<String> {
        let accounts = self.accounts.read().await;
        let same_workspace: Vec<&CodexAccountData> = accounts
            .values()
            .filter(|account| account.workspace_id().as_deref() == Some(auth.account_id.as_str()))
            .collect();
        let target: Option<&CodexAccountData> = match auth.user_identity.as_deref() {
            Some(identity) => same_workspace
                .iter()
                .copied()
                .find(|account| account.user_identity.as_deref() == Some(identity))
                .or_else(|| {
                    // 存量行没有 id_token 无法回填身份：workspace + email 一致视为同一用户
                    same_workspace.iter().copied().find(|account| {
                        account.user_identity.is_none()
                            && account.email.is_some()
                            && account.email.as_deref() == auth.email.as_deref()
                    })
                }),
            None => (same_workspace.len() == 1).then(|| same_workspace[0]),
        };
        target.map(|account| account.account_id.clone())
    }

    #[cfg(test)]
    pub async fn seed_access_token_for_test(&self, account_id: &str, token: &str) {
        self.access_tokens.write().await.insert(
            account_id.to_string(),
            CachedAccessToken {
                token: token.to_string(),
                expires_at_ms: now_ms() + 3_600_000,
            },
        );
    }

    // ==================== 账号管理 ====================

    pub async fn list_accounts(&self) -> Vec<ManagedAccount> {
        let accounts = self.accounts.read().await.clone();
        let default_id = self.resolve_default_account_id().await;
        sorted_accounts(&accounts, default_id.as_deref())
    }

    pub async fn get_status(&self) -> AuthStatus {
        let accounts = self.accounts.read().await.clone();
        let default_id = self.resolve_default_account_id().await;
        AuthStatus {
            authenticated: !accounts.is_empty(),
            default_account_id: default_id.clone(),
            accounts: sorted_accounts(&accounts, default_id.as_deref()),
            external: None,
        }
    }

    pub async fn default_account_id(&self) -> Option<String> {
        self.resolve_default_account_id().await
    }

    pub async fn remove_account(&self, account_id: &str) -> Result<(), CodexOAuthError> {
        {
            let mut accounts = self.accounts.write().await;
            if accounts.remove(account_id).is_none() {
                return Err(CodexOAuthError::AccountNotFound(account_id.to_string()));
            }
        }
        self.database
            .delete_account(account_id)
            .map_err(|error| CodexOAuthError::IoError(error.to_string()))?;
        self.access_tokens.write().await.remove(account_id);
        self.refresh_locks.write().await.remove(account_id);
        {
            let accounts = self.accounts.read().await;
            let mut default = self.default_account_id.write().await;
            if default.as_deref() == Some(account_id) {
                *default = fallback_default_account_id(&accounts);
            }
        }
        let default = self.default_account_id.read().await.clone();
        self.save_default_account(default.as_deref())
    }

    pub async fn is_authenticated(&self) -> bool {
        !self.accounts.read().await.is_empty()
    }

    /// 行 id 对应的 ChatGPT workspace ID（出站请求头用）。
    /// 行 id 与 workspace 解耦后两者不同；查不到时回退行 id 本身（旧行为兼容）。
    pub async fn workspace_of(&self, row_id: &str) -> String {
        let accounts = self.accounts.read().await;
        accounts
            .get(row_id)
            .and_then(|account| account.workspace_id())
            .unwrap_or_else(|| row_id.to_string())
    }

    // ==================== 内部方法 ====================

    /// 登录完成的落库入口（find-or-create）：
    /// - 同 workspace 同用户（sub）→ 幂等更新：原地刷新凭证并保留原 id，供应商绑定不失效；
    /// - 同 workspace 不同用户 → 新增一行（本地主键与 workspace 解耦），
    ///   并发下由唯一索引 accounts_ws_user_uq 兜底，后到者转为更新。
    async fn add_account_internal(
        &self,
        chatgpt_account_id: String,
        refresh_token: String,
        email: Option<String>,
        id_token: Option<String>,
    ) -> Result<ManagedAccount, CodexOAuthError> {
        let user_identity = id_token.as_deref().and_then(extract_user_identity);
        for _ in 0..2 {
            if let Some(row_id) = self
                .find_login_target(
                    &chatgpt_account_id,
                    user_identity.as_deref(),
                    email.as_deref(),
                )
                .await
            {
                return self
                    .reauthenticate_account(
                        &row_id,
                        &chatgpt_account_id,
                        user_identity.as_deref(),
                        refresh_token,
                        id_token,
                        email,
                    )
                    .await;
            }
            let id = format!(
                "acc-{}-{}",
                now_ms(),
                ACCOUNT_ID_SEQ.fetch_add(1, Ordering::Relaxed)
            );
            let data = CodexAccountData {
                account_id: id,
                email: email.clone(),
                id_token: id_token.clone(),
                refresh_token: refresh_token.clone(),
                auth_json: None,
                authenticated_at: now_secs(),
                chatgpt_account_id: Some(chatgpt_account_id.clone()),
                user_identity: user_identity.clone(),
            };
            match self
                .database
                .insert_account_if_absent(&(&data).into())
                .map_err(|error| CodexOAuthError::IoError(error.to_string()))?
            {
                true => {
                    let id = data.account_id.clone();
                    {
                        let mut accounts = self.accounts.write().await;
                        accounts.insert(id.clone(), data);
                    }
                    let should_set_default = {
                        let mut default = self.default_account_id.write().await;
                        let replace = default.is_none();
                        if replace {
                            *default = Some(id.clone());
                        }
                        replace
                    };
                    if should_set_default {
                        self.save_default_account(Some(id.as_str()))?;
                    }
                    return self.managed_account_summary(&id).await;
                }
                // 并发登录抢先落库：重查后转为原地更新
                false => continue,
            }
        }
        Err(CodexOAuthError::RequestFailed(
            "并发登录处理失败，请重试".to_string(),
        ))
    }

    /// 为本次登录寻找归属行（见 add_account_internal 注释）。
    async fn find_login_target(
        &self,
        workspace: &str,
        user_identity: Option<&str>,
        email: Option<&str>,
    ) -> Option<String> {
        let accounts = self.accounts.read().await;
        let same_workspace = accounts
            .values()
            .filter(|account| account.workspace_id().as_deref() == Some(workspace));
        if let Some(identity) = user_identity {
            if let Some(row) = same_workspace
                .clone()
                .find(|account| account.user_identity.as_deref() == Some(identity))
            {
                return Some(row.account_id.clone());
            }
            // 存量行缺 id_token 无法回填身份：workspace + email 一致视为同一用户
            return email.and_then(|email| {
                same_workspace
                    .clone()
                    .find(|account| {
                        account.user_identity.is_none() && account.email.as_deref() == Some(email)
                    })
                    .map(|row| row.account_id.clone())
            });
        }
        // 登录响应缺 sub（异常 token）：退化为旧行为，更新同 workspace 最新一行
        same_workspace
            .max_by_key(|account| account.authenticated_at)
            .map(|row| row.account_id.clone())
    }

    /// 幂等更新：原地刷新凭证、保留行 id；旧凭证衍生的缓存一并失效。
    async fn reauthenticate_account(
        &self,
        row_id: &str,
        chatgpt_account_id: &str,
        user_identity: Option<&str>,
        refresh_token: String,
        id_token: Option<String>,
        email: Option<String>,
    ) -> Result<ManagedAccount, CodexOAuthError> {
        let updated = {
            let mut accounts = self.accounts.write().await;
            let Some(account) = accounts.get_mut(row_id) else {
                return Err(CodexOAuthError::AccountNotFound(row_id.to_string()));
            };
            account.refresh_token = refresh_token;
            if id_token.is_some() {
                account.id_token = id_token;
            }
            if email.is_some() {
                account.email = email;
            }
            account.chatgpt_account_id = Some(chatgpt_account_id.to_string());
            if user_identity.is_some() {
                account.user_identity = user_identity.map(str::to_string);
            }
            account.auth_json = None;
            account.authenticated_at = now_secs();
            account.clone()
        };
        self.save_account(&updated)?;
        self.access_tokens.write().await.remove(row_id);
        self.managed_account_summary(row_id).await
    }

    async fn managed_account_summary(
        &self,
        row_id: &str,
    ) -> Result<ManagedAccount, CodexOAuthError> {
        let (id, email, authenticated_at) = {
            let accounts = self.accounts.read().await;
            let data = accounts
                .get(row_id)
                .ok_or_else(|| CodexOAuthError::AccountNotFound(row_id.to_string()))?;
            (
                data.account_id.clone(),
                data.email.clone(),
                data.authenticated_at,
            )
        };
        let is_default = self.default_account_id.read().await.as_deref() == Some(id.as_str());
        Ok(ManagedAccount {
            id,
            login: display_login(row_id, email),
            authenticated_at,
            is_default,
        })
    }

    async fn resolve_default_account_id(&self) -> Option<String> {
        let stored = self.default_account_id.read().await.clone();
        let accounts = self.accounts.read().await;
        if let Some(id) = stored {
            if accounts.contains_key(&id) {
                return Some(id);
            }
        }
        fallback_default_account_id(&accounts)
    }

    async fn get_refresh_lock(&self, account_id: &str) -> Arc<Mutex<()>> {
        if let Some(lock) = self.refresh_locks.read().await.get(account_id) {
            return Arc::clone(lock);
        }
        Arc::clone(
            self.refresh_locks
                .write()
                .await
                .entry(account_id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        )
    }

    fn save_account(&self, account: &CodexAccountData) -> Result<(), CodexOAuthError> {
        self.database
            .upsert_account(&account.into())
            .map_err(|error| CodexOAuthError::IoError(error.to_string()))
    }

    fn save_default_account(&self, id: Option<&str>) -> Result<(), CodexOAuthError> {
        self.database
            .set_default_account(id)
            .map_err(|error| CodexOAuthError::IoError(error.to_string()))
    }

    fn load_accounts(&self) -> AppResult<()> {
        let stored = self.database.accounts()?;
        let accounts: HashMap<String, CodexAccountData> = stored
            .into_iter()
            .map(|account| (account.id.clone(), account.into()))
            .collect();
        let default = self
            .database
            .app_state()?
            .1
            .or_else(|| fallback_default_account_id(&accounts));
        if let Ok(mut slot) = self.accounts.try_write() {
            *slot = accounts;
        }
        if let Ok(mut slot) = self.default_account_id.try_write() {
            *slot = default;
        }
        Ok(())
    }
}

/// Tauri 托管状态。管理器自身已按账号与数据类型细粒度加锁，外层不再持有跨网络的读写锁。
pub struct CodexOAuthState(pub Arc<CodexOAuthManager>);

fn sorted_accounts(
    accounts: &HashMap<String, CodexAccountData>,
    default_account_id: Option<&str>,
) -> Vec<ManagedAccount> {
    let mut list: Vec<ManagedAccount> = accounts
        .iter()
        .map(|(id, data)| ManagedAccount {
            id: id.clone(),
            login: display_login(id, data.email.clone()),
            authenticated_at: data.authenticated_at,
            is_default: default_account_id == Some(id.as_str()),
        })
        .collect();
    list.sort_by(|a, b| {
        b.is_default
            .cmp(&a.is_default)
            .then_with(|| b.authenticated_at.cmp(&a.authenticated_at))
            .then_with(|| a.login.cmp(&b.login))
    });
    list
}

fn display_login(account_id: &str, email: Option<String>) -> String {
    email.unwrap_or_else(|| format!("ChatGPT ({account_id})"))
}

fn fallback_default_account_id(accounts: &HashMap<String, CodexAccountData>) -> Option<String> {
    accounts
        .iter()
        .max_by(|(id_a, a), (id_b, b)| {
            a.authenticated_at
                .cmp(&b.authenticated_at)
                .then_with(|| id_b.cmp(id_a))
        })
        .map(|(id, _)| id.clone())
}

fn parse_interval(value: Option<&serde_json::Value>) -> u64 {
    let raw = match value {
        Some(serde_json::Value::Number(number)) => number.as_u64().unwrap_or(5),
        Some(serde_json::Value::String(text)) => text.parse::<u64>().unwrap_or(5),
        _ => 5,
    };
    raw.max(1)
}

fn compute_expires_at_ms(expires_in: Option<i64>) -> i64 {
    now_ms() + expires_in.unwrap_or(3600) * 1000
}

fn parse_jwt_claims(token: &str) -> Option<IdTokenClaims> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let decoded = URL_SAFE_NO_PAD.decode(parts[1]).ok()?;
    serde_json::from_slice(&decoded).ok()
}

/// 从 JWT 提取稳定用户身份（sub）：跨刷新不变，判重与 live auth 所有权校验的依据。
/// 迁移回填（database.rs）与登录流程共用。
pub(crate) fn extract_user_identity(token: &str) -> Option<String> {
    parse_jwt_claims(token)?.sub
}

fn extract_identity_from_tokens(tokens: &OAuthTokenResponse) -> (Option<String>, Option<String>) {
    let mut account_id: Option<String> = None;
    let mut email: Option<String> = None;

    if let Some(id_token) = tokens.id_token.as_deref() {
        (account_id, email) = identity_from_jwt(id_token);
    }

    if account_id.is_none() {
        let (fallback_id, fallback_email) = identity_from_jwt(&tokens.access_token);
        account_id = fallback_id;
        if email.is_none() {
            email = fallback_email;
        }
    }

    (account_id, email)
}

fn identity_from_jwt(token: &str) -> (Option<String>, Option<String>) {
    let Some(claims) = parse_jwt_claims(token) else {
        return (None, None);
    };
    (
        claims
            .chatgpt_account_id
            .clone()
            .or_else(|| {
                claims
                    .openai_auth
                    .as_ref()
                    .and_then(|auth| auth.chatgpt_account_id.clone())
            })
            .or_else(|| claims.organizations.first().and_then(|org| org.id.clone())),
        claims.email.clone(),
    )
}

/// Codex CLI 官方 auth.json 中识别出的 ChatGPT 订阅认证（只读、不导入数据库）。
#[derive(Debug, Clone)]
pub struct ExternalCodexAuth {
    /// ChatGPT workspace ID（tokens.account_id 或 id_token claims）
    pub account_id: String,
    pub email: Option<String>,
    pub access_token: String,
    pub id_token: Option<String>,
    pub refresh_token: Option<String>,
    /// id_token 的 sub：同 workspace 多账号时的所有权判据
    pub user_identity: Option<String>,
}

/// 解析 Codex CLI 官方生成的 auth.json。
/// 校验为 ChatGPT 订阅认证（auth_mode=chatgpt 且 access_token 非空）；
/// id_token 缺失或解不出时 account_id 用占位 id。
pub fn parse_external_auth_json(text: &str) -> Option<ExternalCodexAuth> {
    let value: serde_json::Value = serde_json::from_str(text).ok()?;
    if value["auth_mode"].as_str() != Some("chatgpt") {
        return None;
    }
    let tokens = value.get("tokens")?;
    let access_token = tokens
        .get("access_token")
        .and_then(|token| token.as_str())
        .filter(|token| !token.is_empty())?;
    let id_token = tokens
        .get("id_token")
        .and_then(|token| token.as_str())
        .filter(|token| !token.is_empty())
        .map(str::to_string);
    let refresh_token = tokens
        .get("refresh_token")
        .and_then(|token| token.as_str())
        .filter(|token| !token.is_empty())
        .map(str::to_string);
    let (jwt_account_id, email) = match id_token.as_deref() {
        Some(id_token) => identity_from_jwt(id_token),
        None => (None, None),
    };
    let user_identity = id_token.as_deref().and_then(extract_user_identity);
    let account_id = jwt_account_id.or_else(|| {
        tokens
            .get("account_id")
            .and_then(|account_id| account_id.as_str())
            .filter(|account_id| !account_id.is_empty())
            .map(str::to_string)
    });
    Some(ExternalCodexAuth {
        account_id: account_id.unwrap_or_else(|| "codex-external".to_string()),
        email,
        access_token: access_token.to_string(),
        id_token,
        refresh_token,
        user_identity,
    })
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn now_secs() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup(dir: &std::path::Path) -> Arc<Database> {
        let paths = crate::paths::from_home(dir).unwrap();
        Arc::new(Database::open(&paths).unwrap())
    }

    #[test]
    fn parse_interval_handles_number_string_and_default() {
        assert_eq!(parse_interval(Some(&serde_json::json!(5))), 5);
        assert_eq!(parse_interval(Some(&serde_json::json!("10"))), 10);
        assert_eq!(parse_interval(None), 5);
        assert_eq!(parse_interval(Some(&serde_json::json!(0))), 1);
    }

    #[test]
    fn parse_jwt_claims_extracts_account_and_email() {
        let header = URL_SAFE_NO_PAD.encode(b"{\"alg\":\"none\"}");
        let payload = URL_SAFE_NO_PAD
            .encode(b"{\"chatgpt_account_id\":\"acc-123\",\"email\":\"test@example.com\"}");
        let claims = parse_jwt_claims(&format!("{header}.{payload}.")).unwrap();
        assert_eq!(claims.chatgpt_account_id.as_deref(), Some("acc-123"));
        assert_eq!(claims.email.as_deref(), Some("test@example.com"));
    }

    #[test]
    fn parse_jwt_claims_rejects_malformed() {
        assert!(parse_jwt_claims("not-a-jwt").is_none());
        assert!(parse_jwt_claims("only.two").is_none());
    }

    #[test]
    fn parse_external_auth_json_recognizes_chatgpt_shape() {
        let header = URL_SAFE_NO_PAD.encode(b"{\"alg\":\"none\"}");
        let payload = URL_SAFE_NO_PAD
            .encode(b"{\"chatgpt_account_id\":\"acc-123\",\"email\":\"test@example.com\"}");
        let id_token = format!("{header}.{payload}.");
        let json = format!(
            r#"{{"auth_mode":"chatgpt","OPENAI_API_KEY":null,"tokens":{{"access_token":"at-1","id_token":"{id_token}","refresh_token":"rt-1","account_id":"acc-123"}},"last_refresh":"2026-08-17T09:15:01Z"}}"#
        );
        let auth = parse_external_auth_json(&json).unwrap();
        assert_eq!(auth.account_id, "acc-123");
        assert_eq!(auth.email.as_deref(), Some("test@example.com"));
        assert_eq!(auth.access_token, "at-1");
        assert_eq!(auth.id_token.as_deref(), Some(id_token.as_str()));
        assert_eq!(auth.refresh_token.as_deref(), Some("rt-1"));
    }

    #[test]
    fn parse_external_auth_json_rejects_non_chatgpt_or_invalid() {
        assert!(parse_external_auth_json(r#"{"auth_mode":"api"}"#).is_none());
        assert!(parse_external_auth_json(r#"{"auth_mode":"chatgpt"}"#).is_none());
        assert!(parse_external_auth_json(
            r#"{"auth_mode":"chatgpt","tokens":{"access_token":""}}"#
        )
        .is_none());
        assert!(parse_external_auth_json("not-json").is_none());
    }

    #[test]
    fn cached_token_expiry_window() {
        let now = now_ms();
        assert!(CachedAccessToken {
            token: "t".into(),
            expires_at_ms: now + 30_000,
        }
        .is_expiring_soon());
        assert!(!CachedAccessToken {
            token: "t".into(),
            expires_at_ms: now + 3_600_000,
        }
        .is_expiring_soon());
    }

    #[tokio::test]
    async fn manager_persists_accounts_to_sqlite() {
        let dir = tempfile::tempdir().unwrap();
        let database = setup(dir.path());
        let added_id = {
            let manager = CodexOAuthManager::new(database.clone());
            manager
                .add_account_internal(
                    "acc-123".to_string(),
                    "rt-secret".to_string(),
                    Some("user@example.com".to_string()),
                    Some("id-jwt".to_string()),
                )
                .await
                .unwrap()
                .id
        };
        let manager = CodexOAuthManager::new(database.clone());
        let status = manager.get_status().await;
        assert_eq!(status.accounts.len(), 1);
        // 本地主键与 workspace 解耦：行 id 是新生成的，但重启后保持稳定
        assert_eq!(status.accounts[0].id, added_id);
        assert_ne!(added_id, "acc-123");
        assert_eq!(status.accounts[0].login, "user@example.com");
        assert!(status.accounts[0].is_default);
        let stored = database.accounts().unwrap().pop().unwrap();
        assert_eq!(stored.chatgpt_account_id.as_deref(), Some("acc-123"));
    }

    #[tokio::test]
    async fn manager_remove_account_updates_default() {
        let dir = tempfile::tempdir().unwrap();
        let manager = CodexOAuthManager::new(setup(dir.path()));
        let first = manager
            .add_account_internal(
                "acc-123".to_string(),
                "rt".to_string(),
                Some("a@example.com".to_string()),
                None,
            )
            .await
            .unwrap();
        assert_eq!(
            manager.default_account_id().await.as_deref(),
            Some(first.id.as_str())
        );
        let second = manager
            .add_account_internal(
                "acc-456".to_string(),
                "rt2".to_string(),
                Some("b@example.com".to_string()),
                None,
            )
            .await
            .unwrap();
        assert_eq!(
            manager.default_account_id().await.as_deref(),
            Some(first.id.as_str())
        );

        manager.remove_account(&first.id).await.unwrap();
        let accounts = manager.list_accounts().await;
        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].id, second.id);
    }

    #[tokio::test]
    async fn sync_external_auth_updates_only_existing_account() {
        let dir = tempfile::tempdir().unwrap();
        let database = setup(dir.path());
        let manager = CodexOAuthManager::new(database.clone());
        manager
            .add_account_internal(
                "acc-1".to_string(),
                "old-refresh".to_string(),
                Some("old@example.com".to_string()),
                Some("old-id".to_string()),
            )
            .await
            .unwrap();
        let auth = r#"{"auth_mode":"chatgpt","tokens":{"id_token":"new-id","access_token":"new-access","refresh_token":"new-refresh","account_id":"acc-1"}}"#;

        assert!(manager.sync_external_auth_json(auth).await.unwrap());
        assert!(!manager.sync_external_auth_json(auth).await.unwrap());
        let stored = database.accounts().unwrap().pop().unwrap();
        assert_eq!(stored.refresh_token, "new-refresh");
        assert_eq!(stored.id_token.as_deref(), Some("new-id"));
        assert_eq!(stored.auth_json.as_deref(), Some(auth));

        let unknown = auth.replace("acc-1", "unknown");
        assert!(!manager.sync_external_auth_json(&unknown).await.unwrap());
        assert_eq!(manager.list_accounts().await.len(), 1);
    }

    #[tokio::test]
    async fn codex_auth_json_matches_official_chatgpt_shape() {
        let dir = tempfile::tempdir().unwrap();
        let manager = CodexOAuthManager::new(setup(dir.path()));
        let row_id = manager
            .add_account_internal(
                "acc-1".to_string(),
                "rt-1".to_string(),
                Some("a@example.com".to_string()),
                Some("id-jwt".to_string()),
            )
            .await
            .unwrap()
            .id;
        manager.access_tokens.write().await.insert(
            row_id.clone(),
            CachedAccessToken {
                token: "at-1".to_string(),
                expires_at_ms: now_ms() + 3_600_000,
            },
        );

        let json = manager.codex_auth_json(&row_id).await.unwrap();
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(value["auth_mode"], "chatgpt");
        assert!(value["OPENAI_API_KEY"].is_null());
        assert_eq!(value["tokens"]["id_token"], "id-jwt");
        assert_eq!(value["tokens"]["access_token"], "at-1");
        assert_eq!(value["tokens"]["refresh_token"], "rt-1");
        assert_eq!(value["tokens"]["account_id"], "acc-1");
        assert!(value["last_refresh"].is_string());
    }

    /// 构造带 sub 与 workspace 的 id_token（同官方 token 的 claim 形态）
    fn test_id_token(sub: &str, chatgpt_account_id: &str) -> String {
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"none"}"#);
        let payload = URL_SAFE_NO_PAD.encode(
            serde_json::json!({ "sub": sub, "chatgpt_account_id": chatgpt_account_id }).to_string(),
        );
        format!("{header}.{payload}.")
    }

    #[tokio::test]
    async fn login_same_workspace_and_user_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let database = setup(dir.path());
        let manager = CodexOAuthManager::new(database.clone());
        let id_token = test_id_token("user-a", "ws-1");
        let first = manager
            .add_account_internal(
                "ws-1".to_string(),
                "rt-1".to_string(),
                Some("a@example.com".to_string()),
                Some(id_token.clone()),
            )
            .await
            .unwrap();
        let second = manager
            .add_account_internal(
                "ws-1".to_string(),
                "rt-2".to_string(),
                Some("a@example.com".to_string()),
                Some(id_token),
            )
            .await
            .unwrap();

        // 幂等更新：不产生新行、行 id 不变、refresh_token 已刷新
        assert_eq!(first.id, second.id);
        assert_eq!(manager.list_accounts().await.len(), 1);
        let stored = database.accounts().unwrap().pop().unwrap();
        assert_eq!(stored.refresh_token, "rt-2");
        assert_eq!(stored.user_identity.as_deref(), Some("user-a"));
        assert_eq!(stored.chatgpt_account_id.as_deref(), Some("ws-1"));
    }

    #[tokio::test]
    async fn login_same_workspace_different_users_coexist() {
        let dir = tempfile::tempdir().unwrap();
        let database = setup(dir.path());
        let manager = CodexOAuthManager::new(database.clone());
        let first = manager
            .add_account_internal(
                "ws-shared".to_string(),
                "rt-a".to_string(),
                Some("a@example.com".to_string()),
                Some(test_id_token("user-a", "ws-shared")),
            )
            .await
            .unwrap();
        let second = manager
            .add_account_internal(
                "ws-shared".to_string(),
                "rt-b".to_string(),
                Some("b@example.com".to_string()),
                Some(test_id_token("user-b", "ws-shared")),
            )
            .await
            .unwrap();

        // 同 workspace 两个用户各自成行，互不覆盖
        assert_ne!(first.id, second.id);
        assert_eq!(manager.list_accounts().await.len(), 2);
        let stored = database.accounts().unwrap();
        assert_eq!(stored.len(), 2);
        assert!(stored
            .iter()
            .all(|account| account.chatgpt_account_id.as_deref() == Some("ws-shared")));

        // 两行的 auth.json 出站 account_id 都是同一个 workspace ID
        manager.seed_access_token_for_test(&first.id, "at-a").await;
        manager.seed_access_token_for_test(&second.id, "at-b").await;
        for (row_id, token) in [(&first.id, "at-a"), (&second.id, "at-b")] {
            let value: serde_json::Value =
                serde_json::from_str(&manager.codex_auth_json(row_id).await.unwrap()).unwrap();
            assert_eq!(value["tokens"]["account_id"], "ws-shared");
            assert_eq!(value["tokens"]["access_token"], token);
        }
    }

    #[tokio::test]
    async fn sync_external_auth_never_crosses_users_in_same_workspace() {
        let dir = tempfile::tempdir().unwrap();
        let database = setup(dir.path());
        let manager = CodexOAuthManager::new(database.clone());
        manager
            .add_account_internal(
                "ws-shared".to_string(),
                "rt-a".to_string(),
                Some("a@example.com".to_string()),
                Some(test_id_token("user-a", "ws-shared")),
            )
            .await
            .unwrap();
        manager
            .add_account_internal(
                "ws-shared".to_string(),
                "rt-b".to_string(),
                Some("b@example.com".to_string()),
                Some(test_id_token("user-b", "ws-shared")),
            )
            .await
            .unwrap();

        // Codex CLI 用 user-b 的凭证刷新了 live auth.json：只允许落进 user-b 的行
        let live = format!(
            r#"{{"auth_mode":"chatgpt","tokens":{{"id_token":"{}","access_token":"at-b2","refresh_token":"rt-b2","account_id":"ws-shared"}}}}"#,
            test_id_token("user-b", "ws-shared")
        );
        assert!(manager.sync_external_auth_json(&live).await.unwrap());

        let stored = database.accounts().unwrap();
        let row_a = stored
            .iter()
            .find(|account| account.user_identity.as_deref() == Some("user-a"))
            .unwrap();
        let row_b = stored
            .iter()
            .find(|account| account.user_identity.as_deref() == Some("user-b"))
            .unwrap();
        assert_eq!(row_a.refresh_token, "rt-a");
        assert_eq!(row_b.refresh_token, "rt-b2");
        assert_eq!(row_a.auth_json, None);
        assert!(row_b.auth_json.is_some());
        assert_eq!(manager.list_accounts().await.len(), 2);
    }

    #[tokio::test]
    async fn insert_account_if_absent_rejects_duplicate_identity() {
        let dir = tempfile::tempdir().unwrap();
        let database = setup(dir.path());
        let make = |id: &str| StoredAccount {
            id: id.to_string(),
            email: None,
            id_token: None,
            refresh_token: "rt".to_string(),
            auth_json: None,
            authenticated_at: 1,
            chatgpt_account_id: Some("ws-1".to_string()),
            user_identity: Some("user-a".to_string()),
        };
        assert!(database.insert_account_if_absent(&make("row-1")).unwrap());
        // 并发登录抢到同一 (workspace, sub)：唯一索引兜底，调用方转更新
        assert!(!database.insert_account_if_absent(&make("row-2")).unwrap());
        assert_eq!(database.accounts().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn legacy_row_without_id_token_claims_via_email_match() {
        let dir = tempfile::tempdir().unwrap();
        let database = setup(dir.path());
        // 模拟迁移后无 id_token 的存量行：身份两列拿不到 sub（须先于 manager 构造存在）
        database
            .upsert_account(&StoredAccount {
                id: "ws-legacy".to_string(),
                email: Some("a@example.com".to_string()),
                id_token: None,
                refresh_token: "rt-legacy".to_string(),
                auth_json: None,
                authenticated_at: 1,
                chatgpt_account_id: Some("ws-legacy".to_string()),
                user_identity: None,
            })
            .unwrap();
        let manager = CodexOAuthManager::new(database.clone());

        let relogin = manager
            .add_account_internal(
                "ws-legacy".to_string(),
                "rt-new".to_string(),
                Some("a@example.com".to_string()),
                Some(test_id_token("user-a", "ws-legacy")),
            )
            .await
            .unwrap();

        // workspace + email 命中存量行：原地更新并补齐身份，不产生新行
        assert_eq!(relogin.id, "ws-legacy");
        assert_eq!(manager.list_accounts().await.len(), 1);
        let stored = database.accounts().unwrap().pop().unwrap();
        assert_eq!(stored.refresh_token, "rt-new");
        assert_eq!(stored.user_identity.as_deref(), Some("user-a"));
    }
}
