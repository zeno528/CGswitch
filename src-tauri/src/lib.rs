pub mod auth;
pub mod builtin;
pub mod codex;
pub mod commands;
pub mod database;
pub mod error;
pub mod fsutil;
pub mod models;
pub mod paths;
pub mod services;

use std::sync::Arc;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, WindowEvent};
use tauri_plugin_window_state::{Builder as WindowStateBuilder, StateFlags};

use crate::services::AppContext;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let paths = paths::app_paths().expect("无法定位用户数据目录");
    let database = Arc::new(database::Database::open(&paths).expect("无法初始化 CGswitch 数据库"));
    let context = AppContext::new_with_database(paths.clone(), database.clone());
    let oauth_state = auth::CodexOAuthState(Arc::new(tokio::sync::RwLock::new(
        auth::codex_oauth::CodexOAuthManager::new(database),
    )));

    tauri::Builder::default()
        .plugin(tauri_plugin_autostart::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            WindowStateBuilder::default()
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .manage(context)
        .manage(oauth_state)
        .invoke_handler(tauri::generate_handler![
            commands::get_state,
            commands::get_codex_status,
            commands::capture_profile,
            commands::add_builtin_profile,
            commands::add_custom_profile,
            commands::get_builtin_catalog,
            commands::test_profile_connection,
            commands::test_provider_connection,
            commands::get_profile_balance,
            commands::export_database,
            commands::export_database_to,
            commands::import_database,
            commands::list_database_backups,
            commands::restore_database,
            commands::delete_database_backup,
            commands::rename_database_backup,
            commands::rename_profile,
            commands::reorder_profiles,
            commands::set_profile_icon,
            commands::set_profile_show_balance,
            commands::set_profile_balance,
            commands::set_profile_account,
            commands::duplicate_profile,
            commands::get_profile,
            commands::update_profile,
            commands::update_profile_config,
            commands::patch_chatgpt_context_config,
            commands::patch_system_proxy_config,
            commands::validate_toml,
            commands::format_toml,
            commands::delete_profile,
            commands::apply_profile,
            commands::list_mcp_servers,
            commands::save_mcp_server,
            commands::delete_mcp_server,
            commands::get_mcp_section_toml,
            commands::restore_mcp_from_database,
            commands::import_mcp_from_live,
            commands::mcp_sync_preview,
            commands::get_mcp_server_toml,
            commands::patch_mcp_fragment,
            commands::parse_mcp_fragment,
            commands::restart_codex,
            commands::set_window_theme,
            commands::auth_start_login,
            commands::auth_poll_for_account,
            commands::auth_get_status,
            commands::auth_remove_account,
            commands::open_url,
            commands::get_settings,
            commands::save_settings,
            commands::list_plugins,
            commands::list_skills,
            commands::list_plugin_skills,
            commands::list_plugin_marketplaces,
            commands::list_marketplace_plugins,
            commands::add_plugin_marketplace,
            commands::remove_plugin_marketplace,
            commands::install_marketplace_plugin,
            commands::preview_plugin,
            commands::install_plugin,
            commands::uninstall_plugin,
            commands::open_path,
        ])
        .setup(|app| {
            use tauri_plugin_autostart::ManagerExt;

            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                        let _ = window.set_focus();
                    }
                }))?;

            let settings = app.state::<AppContext>().settings().unwrap_or_default();
            if settings.autostart_enabled {
                if let Err(error) = app.autolaunch().enable() {
                    eprintln!("同步开机自启设置失败: {error}");
                }
            }

            let scheduler_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    if let Err(error) = scheduler_handle.state::<AppContext>().auto_backup_if_due()
                    {
                        eprintln!("自动备份失败: {error}");
                    }
                    tokio::time::sleep(std::time::Duration::from_secs(60)).await;
                }
            });

            let show_item = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出 CGswitch", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("缺少应用图标").clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    // 左键单击托盘图标：直接显示主窗口；右键才弹出菜单
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let minimize_to_tray = window
                    .app_handle()
                    .state::<AppContext>()
                    .settings()
                    .map(|settings| settings.minimize_to_tray)
                    .unwrap_or(false);
                if minimize_to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running CGswitch");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::AppResult;

    #[test]
    fn service_context_initializes_empty_database() -> AppResult<()> {
        let dir = tempfile::tempdir().unwrap();
        let paths = paths::from_home(dir.path())?;
        let context = AppContext::new(paths)?;
        let state = context.get_state()?;
        assert!(state.profiles.is_empty());
        assert!(state.active_profile_id.is_none());
        Ok(())
    }
}
