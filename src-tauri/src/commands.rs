use tauri::{AppHandle, State};

use crate::auth::codex_oauth::{
    parse_external_auth_json, AuthStatus, CodexOAuthError, CodexOAuthManager, CodexOAuthState,
    DeviceCodeResponse, ManagedAccount,
};
use crate::codex::config as codex_config;
use crate::error::{app_err, AppResult};
use crate::models::{
    AppState, CodexAppStatus, McpServerSpec, McpSyncPreview, ProfileBalanceInfo, ProfileDetail,
    ProfileSummary, Settings,
};
use crate::services::{
    AppContext, DatabaseBackupInfo, MarketplacePlugin, PluginMarketplace, PluginPreview,
    PluginSkill, PluginSummary, PluginUpdate, ProfileBalance, ProfileConnectionResult,
    SkillSummary,
};

async fn unmanaged_external_codex_auth(
    state: &AppContext,
    oauth: &CodexOAuthState,
) -> AppResult<Option<ManagedAccount>> {
    let Some(external) = state.external_codex_auth()? else {
        return Ok(None);
    };
    let status = oauth.0.read().await.get_status().await;
    if status
        .accounts
        .iter()
        .any(|account| account.id == external.id)
    {
        Ok(None)
    } else {
        Ok(Some(external))
    }
}

fn should_try_next_account_credential(result: &ProfileConnectionResult) -> bool {
    matches!(result.status, Some(401 | 403))
        && !result
            .error
            .as_deref()
            .is_some_and(|error| error.contains("地区限制"))
}

async fn test_account_connection(
    state: &AppContext,
    manager: &CodexOAuthManager,
    account_id: &str,
) -> AppResult<ProfileConnectionResult> {
    let mut tokens = Vec::with_capacity(2);
    if let Some(token) = state.external_codex_access_token_for_account(account_id)? {
        tokens.push(token);
    }
    if let Some(cached) = manager.cached_auth_json(account_id).await {
        if let Some(auth) =
            parse_external_auth_json(&cached).filter(|auth| auth.account_id == account_id)
        {
            if !tokens.iter().any(|token| token == &auth.access_token) {
                tokens.push(auth.access_token);
            }
        }
    }
    for token in tokens {
        let result = state.test_subscription_connection(&token).await?;
        if !should_try_next_account_credential(&result) {
            return Ok(result);
        }
    }

    let auth_json = manager
        .refresh_codex_auth_json(account_id)
        .await
        .map_err(|error| app_err!("{error}"))?;
    let auth = parse_external_auth_json(&auth_json)
        .filter(|auth| auth.account_id == account_id)
        .ok_or_else(|| app_err!("刷新后账号标识不匹配"))?;
    state.test_subscription_connection(&auth.access_token).await
}

#[tauri::command]
pub fn get_state(state: State<'_, AppContext>) -> AppResult<AppState> {
    state.get_state()
}

#[tauri::command]
pub fn get_codex_status(state: State<'_, AppContext>) -> AppResult<CodexAppStatus> {
    state.codex_status()
}

#[tauri::command]
pub async fn list_plugins(state: State<'_, AppContext>) -> AppResult<Vec<PluginSummary>> {
    state.list_plugins().await
}

#[tauri::command]
pub async fn list_skills(state: State<'_, AppContext>) -> AppResult<Vec<SkillSummary>> {
    state.list_skills().await
}

#[tauri::command]
pub async fn get_skill_content(name: String, state: State<'_, AppContext>) -> AppResult<String> {
    state.get_skill_content(&name).await
}

#[tauri::command]
pub async fn get_import_skill_content(
    source_path: String,
    state: State<'_, AppContext>,
) -> AppResult<String> {
    state.get_import_skill_content(&source_path).await
}

#[tauri::command]
pub async fn scan_unmanaged_skills(
    state: State<'_, AppContext>,
) -> AppResult<Vec<super::services::SkillCandidate>> {
    state.scan_unmanaged_skills().await
}

#[tauri::command]
pub async fn import_skill(source_path: String, state: State<'_, AppContext>) -> AppResult<()> {
    state.import_skill(&source_path).await
}

#[tauri::command]
pub async fn enable_skill(name: String, state: State<'_, AppContext>) -> AppResult<()> {
    state.enable_skill(&name).await
}

#[tauri::command]
pub async fn disable_skill(name: String, state: State<'_, AppContext>) -> AppResult<()> {
    state.disable_skill(&name).await
}

#[tauri::command]
pub async fn delete_skill(name: String, state: State<'_, AppContext>) -> AppResult<()> {
    state.delete_skill(&name).await
}

#[tauri::command]
pub async fn list_plugin_skills(
    name: String,
    store_path: Option<String>,
    state: State<'_, AppContext>,
) -> AppResult<Vec<PluginSkill>> {
    state.list_plugin_skills(&name, store_path.as_deref()).await
}

#[tauri::command]
pub async fn list_plugin_marketplaces(
    state: State<'_, AppContext>,
) -> AppResult<Vec<PluginMarketplace>> {
    state.list_plugin_marketplaces().await
}

#[tauri::command]
pub async fn list_marketplace_plugins(
    marketplace: String,
    root: Option<String>,
    state: State<'_, AppContext>,
) -> AppResult<Vec<MarketplacePlugin>> {
    state
        .list_marketplace_plugins(&marketplace, root.as_deref())
        .await
}

#[tauri::command]
pub async fn add_plugin_marketplace(
    url: String,
    state: State<'_, AppContext>,
) -> AppResult<PluginMarketplace> {
    state.add_plugin_marketplace(&url).await
}

#[tauri::command]
pub async fn remove_plugin_marketplace(
    name: String,
    state: State<'_, AppContext>,
) -> AppResult<()> {
    state.remove_plugin_marketplace(&name).await
}

#[tauri::command]
pub async fn install_marketplace_plugin(
    marketplace: String,
    name: String,
    state: State<'_, AppContext>,
) -> AppResult<PluginSummary> {
    state.install_marketplace_plugin(&marketplace, &name).await
}

#[tauri::command]
pub async fn check_plugin_updates(state: State<'_, AppContext>) -> AppResult<Vec<PluginUpdate>> {
    state.check_plugin_updates().await
}

#[tauri::command]
pub async fn upgrade_marketplace_plugin(
    marketplace: String,
    name: String,
    state: State<'_, AppContext>,
) -> AppResult<()> {
    state.upgrade_marketplace_plugin(&marketplace, &name).await
}

#[tauri::command]
pub async fn preview_plugin(url: String, state: State<'_, AppContext>) -> AppResult<PluginPreview> {
    state.preview_plugin(&url).await
}

#[tauri::command]
pub async fn install_plugin(
    url: String,
    sub_path: Option<String>,
    state: State<'_, AppContext>,
) -> AppResult<PluginSummary> {
    state.install_plugin(&url, sub_path.as_deref()).await
}

#[tauri::command]
pub async fn uninstall_plugin(name: String, state: State<'_, AppContext>) -> AppResult<()> {
    state.uninstall_plugin(&name).await
}

#[tauri::command]
pub fn capture_profile(name: String, state: State<'_, AppContext>) -> AppResult<ProfileSummary> {
    state.capture_profile(&name)
}

#[tauri::command]
pub fn add_builtin_profile(
    kind: String,
    base_url: Option<String>,
    api_key: Option<String>,
    admin_url: Option<String>,
    account_id: Option<String>,
    state: State<'_, AppContext>,
) -> AppResult<ProfileSummary> {
    state.add_builtin_profile(
        &kind,
        base_url.as_deref(),
        api_key.as_deref(),
        admin_url.as_deref(),
        account_id.as_deref(),
    )
}

#[tauri::command]
pub fn get_builtin_catalog(
    kind: String,
    state: State<'_, AppContext>,
) -> AppResult<Option<String>> {
    state.get_builtin_catalog(&kind)
}

#[tauri::command]
// 参数个数受前端 IPC 调用约束（一次性提交 config/catalog/auth 三件套），不宜拆结构体
#[allow(clippy::too_many_arguments)]
pub fn add_custom_profile(
    name: String,
    config_text: String,
    base_url: Option<String>,
    api_key: Option<String>,
    admin_url: Option<String>,
    catalog_text: Option<String>,
    auth_text: Option<String>,
    state: State<'_, AppContext>,
) -> AppResult<ProfileSummary> {
    state.add_custom_profile(
        &name,
        &config_text,
        base_url.as_deref(),
        api_key.as_deref(),
        admin_url.as_deref(),
        catalog_text.as_deref(),
        auth_text.as_deref(),
    )
}

#[tauri::command]
pub async fn test_profile_connection(
    id: String,
    base_url: Option<String>,
    api_key: Option<String>,
    state: State<'_, AppContext>,
    oauth: State<'_, CodexOAuthState>,
) -> AppResult<ProfileConnectionResult> {
    // 官方订阅：测认证连通性（token 有效 + 网络可达），走 Codex 官方后端端点
    if state.is_subscription_profile(&id)? {
        let manager = oauth.0.read().await;
        let bound = state.bound_account_id(&id)?;
        return match bound {
            Some(account_id) => test_account_connection(&state, &manager, &account_id).await,
            None => match unmanaged_external_codex_auth(&state, &oauth).await? {
                Some(_) => {
                    let token = state
                        .external_codex_access_token()?
                        .ok_or_else(|| app_err!("未检测到有效的 Codex 官方认证"))?;
                    state.test_subscription_connection(&token).await
                }
                None => match manager.default_account_id().await {
                    Some(account_id) => {
                        test_account_connection(&state, &manager, &account_id).await
                    }
                    None => return Err(app_err!("未检测到已认证的 ChatGPT 订阅账号，请先登录")),
                },
            },
        };
    }
    state
        .test_profile_connection(&id, base_url.as_deref(), api_key.as_deref())
        .await
}

// 创建态表单测试连通：供应商尚未保存，没有 profile id，地址/密钥实时传入
#[tauri::command]
pub async fn test_provider_connection(
    base_url: String,
    api_key: String,
) -> AppResult<ProfileConnectionResult> {
    crate::services::test_provider_connection(&base_url, &api_key).await
}

#[tauri::command]
pub async fn get_profile_balance(
    id: String,
    state: State<'_, AppContext>,
) -> AppResult<ProfileBalance> {
    state.get_profile_balance(&id).await
}

#[tauri::command]
pub fn export_database(state: State<'_, AppContext>) -> AppResult<String> {
    Ok(state.export_database()?.display().to_string())
}

#[tauri::command]
pub fn export_database_to(directory: String, state: State<'_, AppContext>) -> AppResult<String> {
    Ok(state.export_database_to(&directory)?.display().to_string())
}

#[tauri::command]
pub async fn import_database(
    path: String,
    state: State<'_, AppContext>,
    oauth: State<'_, CodexOAuthState>,
) -> AppResult<()> {
    state.import_database(&path)?;
    // 数据库整体替换后，内存中的订阅账号同步重载
    oauth.0.read().await.reload_from_database()?;
    Ok(())
}

#[tauri::command]
pub fn list_database_backups(state: State<'_, AppContext>) -> AppResult<Vec<DatabaseBackupInfo>> {
    state.list_database_backups()
}

#[tauri::command]
pub async fn restore_database(
    name: String,
    state: State<'_, AppContext>,
    oauth: State<'_, CodexOAuthState>,
) -> AppResult<()> {
    state.restore_database(&name)?;
    oauth.0.read().await.reload_from_database()?;
    Ok(())
}

#[tauri::command]
pub fn delete_database_backup(name: String, state: State<'_, AppContext>) -> AppResult<()> {
    state.delete_database_backup(&name)
}

#[tauri::command]
pub fn rename_database_backup(
    old_name: String,
    title: String,
    state: State<'_, AppContext>,
) -> AppResult<()> {
    state.rename_database_backup(&old_name, &title)
}

#[tauri::command]
pub fn rename_profile(id: String, name: String, state: State<'_, AppContext>) -> AppResult<()> {
    state.rename_profile(&id, &name)
}

#[tauri::command]
pub fn set_profile_icon(
    id: String,
    icon: Option<String>,
    state: State<'_, AppContext>,
) -> AppResult<()> {
    state.set_profile_icon(&id, icon.as_deref())
}

#[tauri::command]
pub fn set_profile_show_balance(
    id: String,
    enabled: bool,
    state: State<'_, AppContext>,
) -> AppResult<()> {
    state.set_profile_show_balance(&id, enabled)
}

#[tauri::command]
pub fn set_profile_balance(
    id: String,
    info: ProfileBalanceInfo,
    state: State<'_, AppContext>,
) -> AppResult<()> {
    state.set_profile_balance(&id, &info)
}

#[tauri::command]
pub fn set_profile_account(
    id: String,
    account_id: Option<String>,
    state: State<'_, AppContext>,
) -> AppResult<()> {
    state.set_profile_account(&id, account_id.as_deref())
}

#[tauri::command]
pub fn duplicate_profile(id: String, state: State<'_, AppContext>) -> AppResult<ProfileSummary> {
    state.duplicate_profile(&id)
}

#[tauri::command]
pub fn get_profile(id: String, state: State<'_, AppContext>) -> AppResult<ProfileDetail> {
    state.get_profile(&id)
}

#[tauri::command]
pub fn update_profile(
    id: String,
    name: String,
    base_url: Option<String>,
    api_key: Option<String>,
    admin_url: Option<String>,
    state: State<'_, AppContext>,
) -> AppResult<ProfileSummary> {
    state.update_profile(
        &id,
        &name,
        base_url.as_deref(),
        api_key.as_deref(),
        admin_url.as_deref(),
    )
}

#[tauri::command]
pub fn update_profile_config(
    id: String,
    config_text: String,
    catalog_text: Option<String>,
    auth_text: Option<String>,
    state: State<'_, AppContext>,
) -> AppResult<ProfileDetail> {
    state.update_profile_config(
        &id,
        &config_text,
        catalog_text.as_deref(),
        auth_text.as_deref(),
    )
}

#[tauri::command]
pub fn patch_chatgpt_context_config(config_text: String, enabled: bool) -> AppResult<String> {
    crate::codex::config::patch_context_override(&config_text, enabled)
}

#[tauri::command]
pub fn patch_system_proxy_config(config_text: String, enabled: bool) -> AppResult<String> {
    crate::codex::config::patch_system_proxy(&config_text, enabled)
}

// async 让解析跑在 tokio 线程池而非主线程，避免大文档校验阻塞 UI
#[tauri::command]
pub async fn validate_toml(text: String) -> Vec<crate::codex::config::TomlDiagnostic> {
    crate::codex::config::validate_document(&text)
}

#[tauri::command]
pub fn format_toml(text: String) -> String {
    crate::codex::config::format_document(&text)
}

#[tauri::command]
pub fn delete_profile(id: String, state: State<'_, AppContext>) -> AppResult<()> {
    state.delete_profile(&id)
}

#[tauri::command]
pub fn reorder_profiles(ids: Vec<String>, state: State<'_, AppContext>) -> AppResult<()> {
    state.reorder_profiles(&ids)
}

#[tauri::command]
pub async fn apply_profile(
    id: String,
    state: State<'_, AppContext>,
    oauth: State<'_, CodexOAuthState>,
) -> Result<(), String> {
    state
        .apply_profile(&id)
        .map_err(|error| error.to_string())?;
    // 认证优先级：档案 auth 覆盖 > 显式绑定账号 > 未托管的 Codex 官方认证 > 自动账号回退。
    let is_subscription = state
        .is_subscription_profile(&id)
        .map_err(|error| error.to_string())?;
    let has_auth_override = state
        .has_auth_override(&id)
        .map_err(|error| error.to_string())?;
    if is_subscription && !has_auth_override {
        let manager = oauth.0.read().await;
        let bound = state
            .bound_account_id(&id)
            .map_err(|error| error.to_string())?;
        let external_live = unmanaged_external_codex_auth(&state, &oauth)
            .await
            .map_err(|error| error.to_string())?
            .is_some();
        let account_id = match (bound, external_live) {
            (Some(id), _) => Some(id),
            (None, true) => None,
            (None, false) => manager.default_account_id().await,
        };
        if let Some(account_id) = account_id {
            // 当前 live auth.json 已属于目标账号时，保留 Codex 正在使用的凭据。
            if state
                .external_codex_access_token_for_account(&account_id)
                .map_err(|error| error.to_string())?
                .is_none()
            {
                // 否则优先用缓存凭据离线切换；首次（无缓存）才刷新一次播种。
                let content = match manager.cached_auth_json(&account_id).await {
                    Some(cached) => cached,
                    None => manager
                        .codex_auth_json(&account_id)
                        .await
                        .map_err(|error| error.to_string())?,
                };
                state
                    .write_codex_auth_json(&content)
                    .map_err(|error| error.to_string())?;
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub fn restart_codex(app: AppHandle, state: State<'_, AppContext>) -> AppResult<()> {
    state.restart_codex(&app)
}

/// MCP 服务器管理：直接读写 live ~/.codex/config.toml 的 [mcp_servers.*] 段。
#[tauri::command]
pub fn list_mcp_servers(state: State<'_, AppContext>) -> AppResult<Vec<McpServerSpec>> {
    state.list_mcp_servers()
}

#[tauri::command]
pub fn save_mcp_server(
    original_name: Option<String>,
    spec: McpServerSpec,
    fragment: Option<String>,
    state: State<'_, AppContext>,
) -> AppResult<()> {
    state.save_mcp_server_with_fragment(original_name.as_deref(), spec, fragment.as_deref())
}

#[tauri::command]
pub fn delete_mcp_server(name: String, state: State<'_, AppContext>) -> AppResult<()> {
    state.delete_mcp_server(&name)
}

/// 创建表单预填用：优先数据库 MCP 镜像，首次无镜像时回退 live。
#[tauri::command]
pub fn get_mcp_section_toml(state: State<'_, AppContext>) -> AppResult<String> {
    state.mcp_section_toml()
}

/// 用户显式恢复：数据库镜像写回 live config.toml，返回恢复的服务器数量。
#[tauri::command]
pub fn restore_mcp_from_database(state: State<'_, AppContext>) -> AppResult<usize> {
    state.restore_mcp_from_database()
}

/// 用户显式导入：live 当前 MCP 段强制镜像进数据库，返回导入的服务器数量。
#[tauri::command]
pub fn import_mcp_from_live(state: State<'_, AppContext>) -> AppResult<usize> {
    state.import_mcp_from_live()
}

/// 对比 live config.toml 与数据库镜像的 MCP 差异（只读不写），供同步前人工裁决。
#[tauri::command]
pub fn mcp_sync_preview(state: State<'_, AppContext>) -> AppResult<McpSyncPreview> {
    state.mcp_sync_preview()
}

/// MCP 编辑页初始化：读取 live 中指定服务器的原始片段（含未建模键与注释）。
#[tauri::command]
pub fn get_mcp_server_toml(
    name: String,
    state: State<'_, AppContext>,
) -> AppResult<Option<String>> {
    state.mcp_server_toml(&name)
}

/// MCP 编辑页实时同步：把表单建模字段写进单服务器片段（表单 → 编辑器）。
#[tauri::command]
pub fn patch_mcp_fragment(toml: String, spec: McpServerSpec) -> AppResult<String> {
    codex_config::patch_mcp_fragment(&toml, &spec)
}

/// MCP 编辑页实时同步：单服务器片段解析为建模字段（编辑器 → 表单）。
#[tauri::command]
pub fn parse_mcp_fragment(toml: String) -> AppResult<McpServerSpec> {
    codex_config::parse_mcp_fragment(&toml)
}

#[tauri::command]
pub fn set_window_theme(dark: bool, app: AppHandle) -> AppResult<()> {
    #[cfg(not(windows))]
    {
        let _ = (dark, app);
    }
    #[cfg(windows)]
    {
        use crate::error::app_err;
        use std::ffi::c_void;
        use tauri::Manager; // get_webview_window
        use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
        use windows::Win32::Graphics::Dwm::{DwmSetWindowAttribute, DWMWA_USE_IMMERSIVE_DARK_MODE};
        use windows::Win32::UI::WindowsAndMessaging::{SendMessageW, WM_NCACTIVATE};

        if let Some(window) = app.get_webview_window("main") {
            let hwnd = window
                .hwnd()
                .map_err(|error| app_err!("无法获取窗口句柄: {error}"))?;
            let ours = HWND(hwnd.0);
            let value = i32::from(dark);
            let raw: *const c_void = &value as *const i32 as *const c_void;
            unsafe {
                DwmSetWindowAttribute(
                    ours,
                    DWMWA_USE_IMMERSIVE_DARK_MODE,
                    raw,
                    std::mem::size_of::<i32>() as u32,
                )
            }
            .map_err(|error| app_err!("无法设置窗口标题栏主题: {error}"))?;
            // 强制立即重绘标题栏，避免 DWM 延迟刷新导致与内容主题切换不同步
            unsafe {
                SendMessageW(ours, WM_NCACTIVATE, Some(WPARAM(0)), Some(LPARAM(0)));
                SendMessageW(ours, WM_NCACTIVATE, Some(WPARAM(1)), Some(LPARAM(0)));
            }
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn auth_start_login(
    state: State<'_, CodexOAuthState>,
) -> Result<DeviceCodeResponse, String> {
    state
        .0
        .read()
        .await
        .start_device_flow()
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn auth_poll_for_account(
    device_code: String,
    state: State<'_, CodexOAuthState>,
) -> Result<Option<ManagedAccount>, String> {
    match state.0.write().await.poll_for_token(&device_code).await {
        Ok(account) => Ok(account),
        Err(CodexOAuthError::AuthorizationPending) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub async fn auth_get_status(
    app: State<'_, AppContext>,
    oauth: State<'_, CodexOAuthState>,
) -> Result<AuthStatus, String> {
    let mut status = oauth.0.read().await.get_status().await;
    // 只把不属于 CGswitch 管理列表的 auth.json 识别为 Codex 官方外部认证。
    let external = app
        .external_codex_auth()
        .map_err(|error| error.to_string())?
        .filter(|external| {
            !status
                .accounts
                .iter()
                .any(|account| account.id == external.id)
        });
    if let Some(external) = external {
        status.external = Some(external);
        status.authenticated = true;
    }
    Ok(status)
}

#[tauri::command]
pub async fn auth_remove_account(
    account_id: String,
    state: State<'_, CodexOAuthState>,
) -> Result<(), String> {
    state
        .0
        .write()
        .await
        .remove_account(&account_id)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_url(url: String) -> AppResult<()> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err(app_err!("仅支持打开 http(s) 链接"));
    }
    #[cfg(windows)]
    {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let url_wide = HSTRING::from(&url);
        let operation = HSTRING::from("open");
        let result =
            unsafe { ShellExecuteW(None, &operation, &url_wide, None, None, SW_SHOWNORMAL) };
        if result.0 as usize <= 32 {
            return Err(app_err!("无法打开系统浏览器"));
        }
    }
    #[cfg(not(windows))]
    {
        let _ = std::process::Command::new("open").arg(&url).spawn();
        let _ = std::process::Command::new("xdg-open").arg(&url).spawn();
    }
    Ok(())
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppContext>) -> AppResult<Settings> {
    state.settings()
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    settings: Settings,
    state: State<'_, AppContext>,
) -> AppResult<Settings> {
    if !matches!(
        settings.auto_backup_interval_hours,
        0 | 6 | 12 | 24 | 48 | 168
    ) {
        return Err(app_err!("不支持的自动备份间隔"));
    }
    if !matches!(
        settings.database_backup_keep_count,
        3 | 5 | 10 | 15 | 20 | 30
    ) {
        return Err(app_err!("不支持的备份保留数量"));
    }
    let saved = state.save_settings(&settings)?;
    sync_autostart(&app, &saved)?;
    Ok(saved)
}

fn sync_autostart(app: &AppHandle, settings: &Settings) -> AppResult<()> {
    use tauri_plugin_autostart::ManagerExt;
    if settings.autostart_enabled {
        app.autolaunch()
            .enable()
            .map_err(|error| app_err!("同步开机自启设置失败: {error}"))
    } else {
        let _ = app.autolaunch().disable();
        Ok(())
    }
}

#[tauri::command]
pub fn open_path(path: String, state: State<'_, AppContext>) -> AppResult<()> {
    state.open_path(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cached_auth_failure_allows_same_account_fallback_but_not_network_or_region_errors() {
        assert!(should_try_next_account_credential(
            &ProfileConnectionResult {
                ok: false,
                latency_ms: Some(10),
                status: Some(401),
                error: Some("ChatGPT 登录已失效".to_string()),
            }
        ));
        assert!(should_try_next_account_credential(
            &ProfileConnectionResult {
                ok: false,
                latency_ms: Some(10),
                status: Some(403),
                error: Some("ChatGPT 登录已失效".to_string()),
            }
        ));
        assert!(!should_try_next_account_credential(
            &ProfileConnectionResult {
                ok: false,
                latency_ms: Some(10),
                status: Some(403),
                error: Some("认证请求被地区限制拦截".to_string()),
            }
        ));
        assert!(!should_try_next_account_credential(
            &ProfileConnectionResult {
                ok: false,
                latency_ms: None,
                status: None,
                error: Some("网络错误".to_string()),
            }
        ));
    }
}
