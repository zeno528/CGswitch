use super::profile_config::{is_builtin_placeholder, provider_api_key};
use super::{
    app_err, atomic_write, backup_file, builtin, codex_config, normalize_auth_override, now_ms,
    read_optional_text, AppContext, AppResult, Path, PathBuf, ProfilePayload,
};

impl AppContext {
    pub fn apply_profile(&self, id: &str) -> AppResult<()> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        let config_path = self.paths.codex_config();
        let original = std::fs::read_to_string(&config_path)
            .map_err(|error| app_err!("无法读取 {}: {error}", config_path.display()))?;
        let mut document = codex_config::parse_document(&original)?;

        // 切换前把当前 live 配置回写进正在生效的供应商，使供应商跟随使用中的累计更新
        self.autosync_active_profile(id, &document)?;

        let payload = self.database.profile(id)?.payload;
        if payload.builtin.is_some() {
            self.apply_builtin_profile(id, &payload, "apply", &document)?;
        } else if let Some(raw) = &payload.raw_config {
            // 完整快照供应商：回填完整原文（插件、注释等全部内容）；
            // MCP 段跟随 live 携带（全局生效，不属于任何供应商）
            let content = codex_config::merge_mcp_section(raw, &document);
            backup_file(&config_path, &self.paths.config_backup, "config")?;
            atomic_write(&config_path, content.as_bytes())?;
            self.write_raw_catalog(&payload)?;
            self.write_raw_auth(&payload)?;
            self.database.record_event(
                Some(id),
                "apply",
                "success",
                Some("configuration applied"),
                &now_ms().to_string(),
            )?;
        } else {
            codex_config::apply_to_document(&mut document, &payload)?;
            let updated = codex_config::normalize_global_section_order(&document.to_string());

            backup_file(&config_path, &self.paths.config_backup, "config")?;
            atomic_write(&config_path, updated.as_bytes())?;
            self.write_raw_catalog(&payload)?;
            self.write_raw_auth(&payload)?;
            self.database.record_event(
                Some(id),
                "apply",
                "success",
                Some("configuration applied"),
                &now_ms().to_string(),
            )?;
        }
        // 显式记录当前激活供应商，避免依赖应用日志反推
        self.database.set_active_profile(Some(id))?;
        Ok(())
    }

    /// 内置官方供应商：整文件替换为模板原文（仅替换密钥占位符；MCP 段跟随 live 携带），
    /// 并写入本供应商自带的关联文件（deepseek/智谱各自独立的 models.json、minimax 的 custom-catalog.json），
    /// 写生产文件前都先备份旧文件。
    pub(super) fn apply_builtin_profile(
        &self,
        profile_id: &str,
        payload: &ProfilePayload,
        action: &str,
        live: &toml_edit::DocumentMut,
    ) -> AppResult<()> {
        let kind = payload
            .builtin
            .as_deref()
            .ok_or_else(|| app_err!("供应商缺少内置类型"))?;
        let template = builtin::template(kind)?;
        let api_key = payload.provider_body.as_deref().and_then(provider_api_key);
        // 带密钥占位符的内置供应商：应用前必须已配置真实密钥，避免把占位符写进 live 配置
        if template.placeholder.is_some()
            && api_key
                .as_deref()
                .is_none_or(|key| key.trim().is_empty() || is_builtin_placeholder(payload, key))
        {
            return Err(app_err!(
                "该供应商尚未配置 API 密钥，请先在编辑页填写 API 密钥后再应用"
            ));
        }
        let rendered = match &payload.raw_config {
            Some(raw) => template.substitute_key(raw.as_bytes().to_vec(), api_key.as_deref())?,
            None => template.render_config(api_key.as_deref())?,
        };
        // MCP 段全局生效：模板（或用户编辑过的内置原文）里的段替换为 live 当前段
        let rendered = match String::from_utf8(rendered) {
            Ok(text) => codex_config::merge_mcp_section(&text, live).into_bytes(),
            Err(error) => error.into_bytes(),
        };

        let config_path = self.paths.codex_config();
        backup_file(&config_path, &self.paths.config_backup, "config")?;
        atomic_write(&config_path, &rendered)?;

        if let Some((target, bytes)) = template.catalog {
            let destination = self.paths.codex_home.join(target);
            let stem = Path::new(target)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("codex-file");
            backup_file(&destination, &self.paths.codex_files_backup, stem)?;
            match &payload.raw_catalog {
                Some(raw) => atomic_write(&destination, raw.as_bytes())?,
                None => atomic_write(&destination, bytes)?,
            }
        }

        self.database.record_event(
            Some(profile_id),
            action,
            "success",
            Some("built-in configuration applied"),
            &now_ms().to_string(),
        )?;
        self.write_raw_auth(payload)?;
        Ok(())
    }

    /// 把供应商自己编辑保存的 models.json 原文写入 model_catalog_json 指向的位置。
    pub(super) fn write_raw_catalog(&self, payload: &ProfilePayload) -> AppResult<()> {
        let Some(raw) = payload.raw_catalog.as_deref() else {
            return Ok(());
        };
        let Some(raw_path) = payload.model_values.get("model_catalog_json") else {
            return Ok(());
        };
        let Some(destination) = self.resolve_codex_path(raw_path) else {
            return Ok(());
        };
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| app_err!("无法创建目录 {}: {error}", parent.display()))?;
        }
        let stem = destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("catalog");
        backup_file(&destination, &self.paths.codex_files_backup, stem)?;
        atomic_write(&destination, raw.as_bytes())?;
        Ok(())
    }

    /// 把供应商自己编辑保存的 auth.json 原文写入 ~/.codex/auth.json。
    pub(super) fn write_raw_auth(&self, payload: &ProfilePayload) -> AppResult<()> {
        let Some(raw) = normalize_auth_override(payload.raw_auth.as_deref()) else {
            return Ok(());
        };
        let destination = self.paths.codex_home.join("auth.json");
        backup_file(&destination, &self.paths.codex_files_backup, "auth")?;
        atomic_write(&destination, raw.as_bytes())?;
        Ok(())
    }

    /// 解析 model_catalog_json 指向的路径：支持绝对路径、~/ 开头、以及相对 ~/.codex 的路径。
    pub(super) fn resolve_codex_path(&self, raw: &str) -> Option<PathBuf> {
        let path = raw.trim().trim_matches('"');
        if path.is_empty() {
            return None;
        }
        let raw_path = Path::new(path);
        if let Some(rest) = path.strip_prefix("~/") {
            Some(
                self.paths
                    .codex_home
                    .parent()
                    .unwrap_or(&self.paths.codex_home)
                    .join(rest),
            )
        } else if raw_path.is_absolute() {
            Some(raw_path.to_path_buf())
        } else {
            Some(self.paths.codex_home.join(raw_path))
        }
    }

    /// 把 live 文档同步进当前激活供应商的快照：无激活供应商或内容无差异时不做任何写库。
    /// 供 get_state（刷新/窗口激活）与 get_profile（打开编辑页）按需调用。
    pub(super) fn sync_active_profile_document(
        &self,
        document: &toml_edit::DocumentMut,
    ) -> AppResult<bool> {
        let Some(active_id) = self.active_profile_state()? else {
            return Ok(false);
        };
        let Some(profile) = self
            .database
            .profiles()?
            .iter()
            .find(|profile| profile.id == active_id)
            .cloned()
        else {
            return Ok(false);
        };
        let Ok(mut live) = codex_config::capture_from_document(document) else {
            return Ok(false);
        };
        live.builtin = profile.payload.builtin.clone();
        // 供应商元数据（管理后台网址/余额开关）不属于 live 文档，同步时保留
        live.admin_url = profile.payload.admin_url.clone();
        live.show_balance = profile.payload.show_balance;
        // 使用中模型目录按 live 文件回写；档案自己保存的 auth 覆盖保持不变
        live.raw_catalog = profile
            .payload
            .model_values
            .get("model_catalog_json")
            .and_then(|raw| self.resolve_codex_path(raw))
            .and_then(|file| read_optional_text(&file))
            .or_else(|| profile.payload.raw_catalog.clone());
        live.raw_auth = normalize_auth_override(profile.payload.raw_auth.as_deref());
        // 快照跟随当前 live 完整文本，保证供应商是完整状态（所见即所得，不掩码密钥）
        live.raw_config = Some(document.to_string());
        if live == profile.payload {
            return Ok(false);
        }
        if let Err(error) =
            self.database
                .update_profile(&active_id, &profile.name, &live, &now_ms().to_string())
        {
            let _ = self.database.record_event(
                Some(&active_id),
                "sync",
                "failed",
                Some(&error.0),
                &now_ms().to_string(),
            );
            return Ok(false);
        }
        Ok(true)
    }

    pub(super) fn autosync_active_profile(
        &self,
        target_id: &str,
        document: &toml_edit::DocumentMut,
    ) -> AppResult<()> {
        // 只回写手动应用过的供应商，不做 live 配置推断
        let Some(active_id) = self.active_profile_state()? else {
            return Ok(());
        };
        if active_id == target_id {
            return Ok(());
        }
        self.sync_active_profile_document(document)?;
        Ok(())
    }
}
