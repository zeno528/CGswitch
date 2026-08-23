use super::profile_config::{
    is_builtin_placeholder, parse_provider_detail, profile_config_fragment,
    write_live_provider_update,
};
use super::{
    app_err, atomic_write, backup_file, builtin, codex_config, codex_process,
    normalize_auth_override, now_ms, parse_external_auth_json, profile_summary, read_optional_text,
    AppContext, AppResult, AppState, CodexAppStatus, ProfileDetail, ProfileKind, ProfileSummary,
};

pub(super) fn validated_name(name: &str) -> AppResult<String> {
    let name = name.trim();
    if name.is_empty() || name.len() > 50 {
        return Err(app_err!("供应商名称长度必须在 1 到 50 个字符之间"));
    }
    Ok(name.to_string())
}

pub(crate) fn validated_icon(icon: Option<&str>) -> AppResult<Option<String>> {
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

impl AppContext {
    pub fn get_state(&self) -> AppResult<AppState> {
        // 刷新/窗口激活等显式时机：外部改过 live 就把激活供应商快照同步回数据库（有差异才写）
        let live = self.live_document();
        if let Some(document) = live.as_ref() {
            let _ = self.sync_active_profile_document(document);
        }
        let settings = self.settings()?;
        let profiles = self.database.profiles()?;
        // 激活状态只来自手动应用/捕获（显式状态或应用事件），不做 live 配置推断，
        // 避免“添加供应商”被误判成“正在使用”。
        let active_profile_id = match self.active_profile_state()? {
            Some(id) if profiles.iter().any(|profile| profile.id == id) => Some(id),
            _ => match self.database.latest_applied_profile()? {
                Some(id) if profiles.iter().any(|profile| profile.id == id) => Some(id),
                _ => None,
            },
        };
        let live_payload = live
            .as_ref()
            .and_then(|document| codex_config::capture_from_document(document).ok());
        // 应用安装路径固定 + 自动识别，不支持手动覆盖
        let process_ids = codex_process::find_process_ids(None);
        let (display_path, source) = codex_process::codex_display_path(None);

        Ok(AppState {
            profiles: profiles
                .iter()
                .map(|profile| {
                    let mut stored = profile.clone();
                    // 激活中的供应商：标签读取当前配置文件状态；其余供应商读取数据库最新字段
                    if Some(&stored.id) == active_profile_id.as_ref() {
                        if let Some(live) = &live_payload {
                            let mut live = live.clone();
                            // 供应商元数据（管理后台网址/余额开关）不在 live 配置里，覆盖时保留
                            live.admin_url = stored.payload.admin_url.clone();
                            live.show_balance = stored.payload.show_balance;
                            stored.payload = live;
                        }
                    }
                    profile_summary(&stored)
                })
                .collect::<Vec<ProfileSummary>>(),
            active_profile_id,
            codex: CodexAppStatus {
                running: !process_ids.is_empty(),
                display_path,
                source,
            },
            settings,
            paths: self.path_info(),
            auth_status: Default::default(),
            balance_cache: self.load_balance_cache(),
        })
    }

    /// 轻量 Codex 运行状态查询（仅扫描进程，供前端轮询使用）。
    pub fn codex_status(&self) -> AppResult<CodexAppStatus> {
        let process_ids = codex_process::find_process_ids(None);
        let (display_path, source) = codex_process::codex_display_path(None);
        Ok(CodexAppStatus {
            running: !process_ids.is_empty(),
            display_path,
            source,
        })
    }

    pub(super) fn live_document(&self) -> Option<toml_edit::DocumentMut> {
        let text = std::fs::read_to_string(self.paths.codex_config()).ok()?;
        codex_config::parse_document(&text).ok()
    }

    pub fn capture_profile(&self, name: &str) -> AppResult<ProfileSummary> {
        let name = validated_name(name)?;
        let mut payload = codex_config::read_profile(&self.paths.codex_config())?;
        // 保存完整配置原文，编辑页按完整文件展示/编辑
        payload.raw_config = std::fs::read_to_string(self.paths.codex_config())
            .ok()
            .map(|text| text.trim_end().to_string());
        let timestamp = now_ms().to_string();
        let summary = self.database.insert_profile(&name, &payload, &timestamp)?;
        // 捕获即建立“当前 live = 该供应商”的显式关联：先把旧激活供应商的使用中累计改动
        // 同步回其快照，再把捕获结果设为使用中（捕获到的是什么就用什么，不比对内容）
        if let Some(document) = self.live_document() {
            self.autosync_active_profile(&summary.id, &document)?;
        }
        self.database.set_active_profile(Some(&summary.id))?;
        self.database.record_event(
            Some(&summary.id),
            "capture",
            "success",
            Some("captured live configuration and set active"),
            &timestamp,
        )?;
        Ok(summary)
    }

    pub fn add_builtin_profile(
        &self,
        kind: &str,
        base_url: Option<&str>,
        api_key: Option<&str>,
        admin_url: Option<&str>,
        account_id: Option<&str>,
    ) -> AppResult<ProfileSummary> {
        let template = builtin::template(kind)?;
        let base_url = base_url.map(str::trim).filter(|value| !value.is_empty());
        let api_key = api_key.map(str::trim).filter(|key| !key.is_empty());
        // 只创建快照，不写生产环境；快照内容与最终应用时渲染的 config 一致
        let rendered = template.render_config(None)?;
        let text =
            std::str::from_utf8(&rendered).map_err(|_| app_err!("内置模板不是有效 UTF-8"))?;
        let mut payload =
            codex_config::capture_from_document(&codex_config::parse_document(text)?)?;
        payload.builtin = Some(template.kind.to_string());
        // 快照优先并入数据库 MCP 镜像；首次使用时镜像为空才回退 live。
        payload.raw_config = Some(codex_config::merge_mcp_section(
            text,
            &self.mcp_document_for_new_profile()?,
        ));
        if let Some(admin_url) = admin_url.map(str::trim).filter(|value| !value.is_empty()) {
            payload.admin_url = Some(admin_url.to_string());
        }
        if base_url.is_some() || api_key.is_some() {
            let body = payload
                .provider_body
                .as_deref()
                .ok_or_else(|| app_err!("内置供应商缺少配置"))?;
            payload.provider_body =
                Some(codex_config::update_provider_body(body, base_url, api_key)?);
        }
        let timestamp = now_ms().to_string();
        let summary = self
            .database
            .insert_profile(template.name, &payload, &timestamp)?;
        self.database
            .set_profile_icon(&summary.id, Some(template.icon), &timestamp)?;
        // 官方订阅档案创建时可直接绑定账号；第三方忽略绑定参数
        if payload.provider_id.is_none() {
            if let Some(account_id) = account_id {
                self.set_profile_account(&summary.id, Some(account_id))?;
            }
        }
        self.database.record_event(
            Some(&summary.id),
            "add_builtin",
            "success",
            Some("added built-in profile"),
            &timestamp,
        )?;
        let stored = self.database.profile(&summary.id)?;
        Ok(profile_summary(&stored))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn add_custom_profile(
        &self,
        name: &str,
        config_text: &str,
        base_url: Option<&str>,
        api_key: Option<&str>,
        admin_url: Option<&str>,
        catalog_text: Option<&str>,
        auth_text: Option<&str>,
    ) -> AppResult<ProfileSummary> {
        let name = validated_name(name)?;
        if config_text.trim().is_empty() {
            return Err(app_err!("请填写 config.toml 内容"));
        }
        let document = codex_config::parse_document(config_text)?;
        let mut payload = codex_config::capture_from_document(&document)?;
        let base_url = base_url.map(str::trim).filter(|value| !value.is_empty());
        let api_key = api_key.map(str::trim).filter(|key| !key.is_empty());
        if let Some(admin_url) = admin_url.map(str::trim).filter(|value| !value.is_empty()) {
            payload.admin_url = Some(admin_url.to_string());
        }
        if base_url.is_some() || api_key.is_some() {
            let body = payload.provider_body.as_deref().ok_or_else(|| {
                app_err!("配置中缺少 model_providers 段落，无法写入调用地址/密钥")
            })?;
            payload.provider_body =
                Some(codex_config::update_provider_body(body, base_url, api_key)?);
        }
        // 快照优先并入数据库 MCP 镜像；首次使用时镜像为空才回退 live。
        payload.raw_config = Some(codex_config::merge_mcp_section(
            config_text.trim_end(),
            &self.mcp_document_for_new_profile()?,
        ));
        if let Some(text) = catalog_text {
            let text = text.trim();
            if !text.is_empty() {
                serde_json::from_str::<serde_json::Value>(text)
                    .map_err(|error| app_err!("models.json 不是有效 JSON: {error}"))?;
                payload.raw_catalog = Some(text.to_string());
            }
        }
        if let Some(text) = auth_text {
            let text = text.trim();
            if !text.is_empty() {
                serde_json::from_str::<serde_json::Value>(text)
                    .map_err(|error| app_err!("auth.json 不是有效 JSON: {error}"))?;
            }
            payload.raw_auth = normalize_auth_override(Some(text));
        }
        let timestamp = now_ms().to_string();
        let summary = self.database.insert_profile(&name, &payload, &timestamp)?;
        self.database.record_event(
            Some(&summary.id),
            "add_custom",
            "success",
            Some("added custom profile"),
            &timestamp,
        )?;
        let stored = self.database.profile(&summary.id)?;
        Ok(profile_summary(&stored))
    }

    /// 返回内置模板自带的关联文件原文（deepseek/智谱 的 models.json、minimax 的 custom-catalog.json），
    /// 供创建页在保存前预览；ChatGPT 无关联文件返回 None。
    pub fn get_builtin_catalog(&self, kind: &str) -> AppResult<Option<String>> {
        let template = builtin::template(kind)?;
        Ok(template
            .catalog
            .map(|(_, bytes)| String::from_utf8_lossy(bytes).into_owned()))
    }

    pub fn rename_profile(&self, id: &str, name: &str) -> AppResult<()> {
        let name = validated_name(name)?;
        self.database
            .rename_profile(id, &name, &now_ms().to_string())
    }

    pub fn reorder_profiles(&self, ids: &[String]) -> AppResult<()> {
        self.database.reorder_profiles(ids, &now_ms().to_string())
    }

    pub fn delete_profile(&self, id: &str) -> AppResult<()> {
        self.database.delete_profile(id)?;
        if self.active_profile_state()?.as_deref() == Some(id) {
            self.database.set_active_profile(None)?;
        }
        Ok(())
    }

    pub fn set_profile_icon(&self, id: &str, icon: Option<&str>) -> AppResult<()> {
        let icon = validated_icon(icon)?;
        self.database
            .set_profile_icon(id, icon.as_deref(), &now_ms().to_string())
    }

    /// 供应商级开关：是否在卡片显示并自动刷新 DeepSeek 余额。
    pub fn set_profile_show_balance(&self, id: &str, enabled: bool) -> AppResult<()> {
        let stored = self.database.profile(id)?;
        let mut payload = stored.payload;
        payload.show_balance = enabled;
        self.database
            .update_profile(id, &stored.name, &payload, &now_ms().to_string())
            .map(|_| ())
    }

    /// 完整复制供应商（配置、关联文件、图标、账号绑定），新供应商名加“副本”后缀，同名时追加序号。
    pub fn duplicate_profile(&self, id: &str) -> AppResult<ProfileSummary> {
        // 使用中的供应商：先把 live 的 config/models.json 改动同步回快照，副本取到最新状态
        let active = self.is_active_profile(id)?;
        if active {
            if let Some(document) = self.live_document() {
                let _ = self.sync_active_profile_document(&document);
            }
        }
        let mut stored = self.database.profile(id)?;
        stored.payload.raw_auth = normalize_auth_override(stored.payload.raw_auth.as_deref());
        // 使用中的第三方供应商：快照没单独保存 auth 时连当前 live auth.json 一起复制，
        // 保证副本应用后凭据与源一致；官方订阅的 auth 由账号动态生成，不复制。
        // 外部 Codex 官方认证属于全局订阅凭据，不吞进第三方档案（避免副本应用时覆盖官方认证）。
        if active && stored.kind == ProfileKind::ThirdParty && stored.payload.raw_auth.is_none() {
            stored.payload.raw_auth = read_optional_text(&self.paths.codex_home.join("auth.json"))
                .filter(|text| parse_external_auth_json(text).is_none());
        }
        let profiles = self.database.profiles()?;
        let base: String = stored.name.trim().chars().take(47).collect();
        let mut candidate = format!("{base} 副本");
        let mut counter = 2;
        while profiles
            .iter()
            .any(|profile| profile.name.eq_ignore_ascii_case(&candidate))
        {
            candidate = format!("{base} 副本 {counter}");
            counter += 1;
        }
        let timestamp = now_ms().to_string();
        let summary = self
            .database
            .insert_profile(&candidate, &stored.payload, &timestamp)?;
        self.database
            .set_profile_icon(&summary.id, stored.icon.as_deref(), &timestamp)?;
        // 官方供应商的订阅账号绑定一并复制（第三方恒为 None 不会进这个分支）
        if stored.account_id.is_some() {
            self.database.set_profile_account(
                &summary.id,
                stored.account_id.as_deref(),
                &timestamp,
            )?;
        }
        self.database.record_event(
            Some(&summary.id),
            "duplicate",
            "success",
            Some("profile duplicated"),
            &timestamp,
        )?;
        let stored = self.database.profile(&summary.id)?;
        Ok(profile_summary(&stored))
    }

    pub fn get_profile(&self, id: &str) -> AppResult<ProfileDetail> {
        // 打开激活供应商的编辑页：先把外部改动同步回数据库快照
        if self.is_active_profile(id)? {
            if let Some(document) = self.live_document() {
                let _ = self.sync_active_profile_document(&document);
            }
        }
        let stored = self.database.profile(id)?;
        let payload = &stored.payload;
        let active = self.is_active_profile(id)?;
        let provider = payload
            .provider_body
            .as_deref()
            .map(parse_provider_detail)
            .transpose()?;
        let stored_key = provider.as_ref().and_then(|detail| detail.api_key.clone());
        let api_key = stored_key
            .as_deref()
            .filter(|key| !is_builtin_placeholder(payload, key))
            .map(str::to_string);

        // 使用中：live 文件是唯一事实源；未使用：数据库快照
        let live_config = active
            .then(|| read_optional_text(&self.paths.codex_config()))
            .flatten();
        let live_catalog = if active {
            payload
                .model_values
                .get("model_catalog_json")
                .and_then(|raw| self.resolve_codex_path(raw))
                .and_then(|file| read_optional_text(&file))
        } else {
            None
        };
        let live_auth = active
            .then(|| read_optional_text(&self.paths.codex_home.join("auth.json")))
            .flatten();

        // 使用中：live 文件原样展示；未使用：数据库快照原样展示（所见即所得，不再掩码）
        let raw_config = live_config.or_else(|| payload.raw_config.clone());
        let config_fragment = match raw_config.as_deref() {
            Some(raw) => match payload.builtin.as_deref() {
                // 内置供应商：占位符替换为已存密钥，展示应用时的真实配置
                Some(kind) => {
                    let template = builtin::template(kind)?;
                    String::from_utf8_lossy(
                        &template.substitute_key(raw.as_bytes().to_vec(), stored_key.as_deref())?,
                    )
                    .into_owned()
                }
                None => raw.to_string(),
            },
            None => match payload.builtin.as_deref() {
                Some(kind) => {
                    let template = builtin::template(kind)?;
                    String::from_utf8_lossy(&template.render_config(stored_key.as_deref())?)
                        .into_owned()
                }
                None => profile_config_fragment(payload),
            },
        };
        let catalog_content = if active {
            live_catalog.or_else(|| payload.raw_catalog.clone())
        } else {
            payload.raw_catalog.clone()
        }
        .or_else(|| {
            payload
                .builtin
                .as_deref()
                .and_then(|kind| builtin::template(kind).ok())
                .and_then(|template| template.catalog)
                .map(|(_, bytes)| String::from_utf8_lossy(bytes).into_owned())
        });
        let raw_auth = normalize_auth_override(payload.raw_auth.as_deref());

        Ok(ProfileDetail {
            id: stored.id.clone(),
            name: stored.name.clone(),
            account_id: stored.account_id.clone(),
            icon: stored.icon.clone(),
            provider: payload.provider_id.clone(),
            base_url: provider.as_ref().and_then(|detail| detail.base_url.clone()),
            api_key,
            model_values: payload.model_values.clone(),
            config_fragment,
            raw_config,
            // 官方订阅：展示当前生效的全局认证（未保存时不写进档案）；
            // 第三方：只展示档案级认证，避免把 live 的 Codex 官方认证预填进编辑页、保存时意外收进档案
            auth_content: if stored.kind == ProfileKind::Official {
                raw_auth.clone().or(live_auth)
            } else {
                raw_auth.clone()
            },
            catalog_content,
            raw_catalog: payload.raw_catalog.clone(),
            raw_auth,
            admin_url: payload.admin_url.clone(),
            show_balance: payload.show_balance,
            updated_at: stored.updated_at.clone(),
        })
    }

    /// 保存供应商自身的完整配置原文：内置供应商存 raw_config（应用时整文件回填）；
    /// 普通供应商解析回结构化字段（继续走合并回填）。models.json 统一存 raw_catalog。
    pub fn update_profile_config(
        &self,
        id: &str,
        config_text: &str,
        catalog_text: Option<&str>,
        auth_text: Option<&str>,
    ) -> AppResult<ProfileDetail> {
        let stored = self.database.profile(id)?;
        let mut payload = stored.payload;

        // 清空 auth 内容 = 移除档案级覆盖，恢复为账号自动凭据
        let auth_override = auth_text
            .map(str::trim)
            .and_then(|text| normalize_auth_override(Some(text)));
        let document = codex_config::parse_document(config_text)?;
        if let Some(text) = catalog_text {
            serde_json::from_str::<serde_json::Value>(text)
                .map_err(|error| app_err!("models.json 不是有效 JSON: {error}"))?;
        }
        if let Some(text) = auth_override.as_deref() {
            serde_json::from_str::<serde_json::Value>(text)
                .map_err(|error| app_err!("auth.json 不是有效 JSON: {error}"))?;
        }

        // 所见即所得：编辑器文本是唯一事实源，内置/普通供应商都重新解析结构化字段
        let parsed = codex_config::capture_from_document(&document)?;
        // 供应商身份跟随当前配置：用户改了什么名字，胶囊就显示什么；不再用旧库值拦截
        if payload.builtin.is_some() && parsed.provider_id != payload.provider_id {
            // 改写了内置供应商的 provider 身份后脱离内置模板，按完整快照档案应用
            payload.builtin = None;
        }
        payload.provider_id = parsed.provider_id;
        payload.model_values = parsed.model_values;
        payload.provider_body = parsed.provider_body;
        payload.raw_config = Some(config_text.to_string());
        if catalog_text.is_some() {
            payload.raw_catalog = catalog_text.map(str::to_string);
        }
        if auth_text.is_some() {
            payload.raw_auth = auth_override.clone();
        }
        self.database
            .update_profile(id, &stored.name, &payload, &now_ms().to_string())?;

        // 使用中：编辑内容立即写进当前 Codex 文件（是否生效由 Codex 重启决定）
        if self.is_active_profile(id)? {
            let config_path = self.paths.codex_config();
            backup_file(&config_path, &self.paths.config_backup, "config")?;
            atomic_write(
                &config_path,
                codex_config::normalize_global_section_order(config_text).as_bytes(),
            )?;
            if catalog_text.is_some() {
                self.write_raw_catalog(&payload)?;
            }
            if auth_text.is_some() && payload.raw_auth.is_some() {
                self.write_raw_auth(&payload)?;
            }
        }
        self.get_profile(id)
    }

    pub fn update_profile(
        &self,
        id: &str,
        name: &str,
        base_url: Option<&str>,
        api_key: Option<&str>,
        admin_url: Option<&str>,
    ) -> AppResult<ProfileSummary> {
        let name = validated_name(name)?;
        let stored = self.database.profile(id)?;
        let mut payload = stored.payload;
        let admin_url = admin_url.map(str::trim).filter(|value| !value.is_empty());
        if let Some(url) = admin_url {
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                return Err(app_err!("管理后台网址必须以 http:// 或 https:// 开头"));
            }
        }
        payload.admin_url = admin_url.map(str::to_string);
        if payload.provider_id.is_some() {
            let body = payload
                .provider_body
                .as_deref()
                .ok_or_else(|| app_err!("该供应商缺少配置数据"))?;
            if base_url.is_some() || api_key.is_some() {
                payload.provider_body =
                    Some(codex_config::update_provider_body(body, base_url, api_key)?);
            }
        } else if base_url.is_some() || api_key.is_some() {
            return Err(app_err!("该供应商缺少配置，无法修改调用地址或密钥"));
        }
        let write_back = (base_url.is_some() || api_key.is_some())
            && payload.provider_id.is_some()
            && self.is_active_profile(id)?;
        let updated = self
            .database
            .update_profile(id, &name, &payload, &now_ms().to_string())?;
        if write_back {
            // 使用中：只就地更新 live 的供应商段落，保留 Codex 期间生成的其他内容
            write_live_provider_update(
                self,
                id,
                payload.provider_id.as_deref().expect("已检查 provider_id"),
                base_url,
                api_key,
            )?;
        }
        Ok(profile_summary(&updated))
    }
}
