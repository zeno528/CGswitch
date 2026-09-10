use super::storage::{backup_keep_count, DATABASE_BACKUP_PREFIX};
use super::{
    app_err, atomic_write, codex_process, now_ms, prune_backups, AppContext, AppResult, Path,
    PathInfo, Settings,
};

fn open_in_file_explorer(path: &Path) -> AppResult<()> {
    #[cfg(windows)]
    {
        use windows::{
            core::HSTRING,
            Win32::{
                System::Com::CoInitialize,
                UI::Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems},
            },
        };

        let _ = unsafe { CoInitialize(None) };
        let folder = if path.is_file() {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        let folder_text = HSTRING::from(folder);
        let folder_id = unsafe { ILCreateFromPathW(&folder_text) };
        if folder_id.is_null() {
            return Err(app_err!("无法定位资源管理器路径：{}", folder.display()));
        }
        let item_text = HSTRING::from(path);
        let item_id = path
            .is_file()
            .then(|| unsafe { ILCreateFromPathW(&item_text) });
        let selection = item_id
            .filter(|item| !item.is_null())
            .map(|item| [item.cast_const()]);
        let result = unsafe {
            SHOpenFolderAndSelectItems(
                folder_id.cast_const(),
                selection.as_ref().map(|items| &items[..]),
                0,
            )
        };
        unsafe {
            ILFree(Some(folder_id.cast_const()));
            if let Some(item) = item_id.filter(|item| !item.is_null()) {
                ILFree(Some(item.cast_const()));
            }
        }
        result.map_err(|error| app_err!("无法打开资源管理器：{error}"))
    }

    #[cfg(not(windows))]
    {
        std::process::Command::new("open")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| app_err!("无法打开文件管理器：{error}"))
    }
}

impl AppContext {
    pub fn restart_codex(&self) -> AppResult<()> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        self.sync_active_profile_from_live_locked()?;
        let process_ids = codex_process::find_process_ids(None);
        if !process_ids.is_empty() {
            codex_process::terminate_process_ids(&process_ids);
            // 固定等待 5 秒（可配置的“重启等待超时”已移除）
            let exited = codex_process::wait_for_exit(&process_ids, 5_000, 100);
            if !exited {
                let message = "Codex 未在超时时间内退出，已取消重新启动";
                self.database.record_event(
                    None,
                    "restart",
                    "timeout",
                    Some(message),
                    &now_ms().to_string(),
                )?;
                return Err(app_err!("{message}"));
            }
        }
        let result = (|| {
            codex_process::launch_codex(None)?;
            if codex_process::wait_for_running(10_000, 100) {
                Ok(())
            } else {
                Err(app_err!("Codex 启动超时，请检查应用是否可以正常打开"))
            }
        })();
        let status = if result.is_ok() { "success" } else { "failed" };
        let message = result.as_ref().err().map(|error| error.0.clone());
        self.database.record_event(
            None,
            "restart",
            status,
            message.as_deref(),
            &now_ms().to_string(),
        )?;
        result
    }

    pub fn settings(&self) -> AppResult<Settings> {
        let path = &self.paths.settings;
        let text = match std::fs::read_to_string(path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // 首次运行：写出默认设置文件，方便直接手动编辑
                let defaults = Settings::default();
                let text = serde_json::to_string_pretty(&defaults)
                    .map_err(|_| app_err!("默认设置序列化失败"))?;
                atomic_write(path, text.as_bytes())?;
                return Ok(defaults);
            }
            Err(error) => return Err(app_err!("无法读取设置文件 {}: {error}", path.display())),
        };
        serde_json::from_str(&text)
            .map_err(|error| app_err!("设置文件 {} 无效: {error}", path.display()))
    }

    pub fn save_settings(&self, settings: &Settings) -> AppResult<Settings> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        let mut settings = settings.clone();
        settings.theme = settings.theme.trim().to_lowercase();
        if !["system", "light", "dark"].contains(&settings.theme.as_str()) {
            return Err(app_err!("不支持的主题设置"));
        }
        // 语言值大小写不敏感地归一到规范形式（容忍手动编辑过 settings.json）
        settings.language = match settings.language.trim().to_ascii_lowercase().as_str() {
            "zh-cn" | "zh" => "zh-CN".into(),
            "en-us" | "en" => "en-US".into(),
            "system" => "system".into(),
            _ => return Err(app_err!("不支持的界面语言设置")),
        };
        let text =
            serde_json::to_string_pretty(&settings).map_err(|_| app_err!("设置序列化失败"))?;
        atomic_write(&self.paths.settings, text.as_bytes())?;
        prune_backups(
            &self.paths.database_backup,
            DATABASE_BACKUP_PREFIX,
            ".db",
            backup_keep_count(settings.database_backup_keep_count),
        );
        Ok(settings)
    }

    pub fn set_update_marker(&self, version: &str) -> AppResult<()> {
        atomic_write(&self.paths.update_marker, version.as_bytes())
    }

    /// 读取并清除「已更新到 vX」标记（一次性消费）；无标记返回 None。
    pub fn take_update_marker(&self) -> AppResult<Option<String>> {
        match std::fs::read_to_string(&self.paths.update_marker) {
            Ok(text) => {
                let _ = std::fs::remove_file(&self.paths.update_marker);
                Ok(Some(text.trim().to_string()))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(error) => Err(app_err!("无法读取更新标记: {error}")),
        }
    }

    pub fn open_path(&self, path: &str) -> AppResult<()> {
        if !self.is_managed_path(path) {
            return Err(app_err!("不能打开未列出的本机路径"));
        }
        open_in_file_explorer(Path::new(path))
    }

    pub(super) fn path_info(&self) -> Vec<PathInfo> {
        vec![
            PathInfo {
                label: "应用数据目录".into(),
                path: self.paths.root.display().to_string(),
            },
            PathInfo {
                label: "备份目录".into(),
                path: self.paths.root.join("backups").display().to_string(),
            },
            PathInfo {
                label: "Codex 配置".into(),
                path: self.paths.codex_config().display().to_string(),
            },
        ]
    }

    pub(super) fn is_managed_path(&self, path: &str) -> bool {
        self.path_info().iter().any(|item| item.path == path)
    }
}
