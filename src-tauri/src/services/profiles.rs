use super::profile_config::{
    is_builtin_placeholder, parse_provider_detail, profile_config_fragment,
    write_live_provider_update,
};
use super::{
    app_err, atomic_write, backup_file, builtin, codex_config, codex_process,
    normalize_auth_override, now_ms, parse_external_auth_json, profile_summary, read_optional_text,
    AppContext, AppResult, AppState, AuthSource, CodexAppStatus, ProfileDetail, ProfileKind,
    ProfileSummary,
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

/// 配置主体块（日志用）：官方配置带 source，名称按 Debug 格式转义为 logfmt 字符串。
fn profile_subject(summary: &ProfileSummary) -> String {
    let name = format!("{:?}", summary.name);
    match summary.auth_source {
        Some(AuthSource::Oauth) => {
            format!("profile_id={} profile_name={name} source=oauth", summary.id)
        }
        Some(AuthSource::Desktop) => {
            format!(
                "profile_id={} profile_name={name} source=desktop",
                summary.id
            )
        }
        None => format!("profile_id={} profile_name={name}", summary.id),
    }
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
        // 激活状态只来自手动应用（显式状态或应用事件），不做 live 配置推断，
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
            profiles: profiles
                .iter()
                .map(|profile| {
                    let mut stored = profile.clone();
                    // 激活中的供应商：标签读取当前配置文件状态；其余供应商读取数据库最新字段
                    if Some(&stored.id) == active_profile_id.as_ref() {
                        if let Some(live) = &live_payload {
                            let mut live = live.clone();
                            // 供应商元数据不在 live 配置里，覆盖时保留。
                            live.admin_url = stored.payload.admin_url.clone();
                            live.show_balance = stored.payload.show_balance;
                            live.fetched_models = stored.payload.fetched_models.clone();
                            stored.payload = live;
                        }
                    }
                    let mut summary = profile_summary(&stored);
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
            balance_cache,
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

    /// 读不了就当没有：调用方不需要区分"文件不存在"和"解析失败"。
    pub(super) fn live_document(&self) -> Option<toml_edit::DocumentMut> {
        self.live_document_checked().ok().flatten()
    }

    /// `live_document` 的保留错误版：同一次读取、同一次解析，但把错误交出来。
    /// 拉起 Codex 前用它：这份文件读不了，Codex 也起不来，日志必须留痕。
    /// 文件不存在返回 `None`（首次运行）。
    pub(super) fn live_document_checked(&self) -> AppResult<Option<toml_edit::DocumentMut>> {
        let path = self.paths.codex_config();
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(app_err!("无法读取 {}: {error}", path.display())),
        };
        Ok(Some(codex_config::parse_document(&text)?))
    }

    pub fn capture_profile(&self, name: &str) -> AppResult<ProfileSummary> {
        let name = validated_name(name)?;
        let mut payload = codex_config::read_profile(&self.paths.codex_config())?;
        // 保存完整配置原文，编辑页按完整文件展示/编辑
        payload.raw_config = std::fs::read_to_string(self.paths.codex_config())
            .ok()
            .map(|text| text.trim_end().to_string())
            .map(|text| codex_config::without_managed_mcp_servers(&text))
            .transpose()?;
        let timestamp = now_ms().to_string();
        let summary = self.database.insert_profile(&name, &payload, &timestamp)?;
        // 捕获只保存快照；保留当前激活供应商，并把它在 live 中的累计改动同步回快照。
        if let Some(document) = self.live_document() {
            self.sync_active_profile_document(&document)?;
        }
        self.database.record_event(
            Some(&summary.id),
            "capture",
            "success",
            Some("captured live configuration"),
            &timestamp,
        )?;
        tauri_plugin_log::log::info!(
            "[provider.profile.create] {} outcome=success msg=\"已捕获 live 配置\"",
            profile_subject(&summary)
        );
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
        payload.raw_config = Some(codex_config::without_managed_mcp_servers(
            &codex_config::merge_mcp_section(text, &self.mcp_document_for_new_profile()?),
        )?);
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
        if payload.provider_id.is_none() {
            payload.auth_source = Some(if account_id.is_some() {
                AuthSource::Oauth
            } else {
                AuthSource::Desktop
            });
        }
        let timestamp = now_ms().to_string();
        let summary = self
            .database
            .insert_profile(template.name, &payload, &timestamp)?;
        self.database
            .set_profile_icon(&summary.id, Some(template.icon), &timestamp)?;
        // 创建官方订阅配置时可直接绑定账号；第三方忽略绑定参数
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
        let summary = profile_summary(&stored);
        tauri_plugin_log::log::info!(
            "[provider.profile.create] {} outcome=success msg=\"已创建配置\"",
            profile_subject(&summary)
        );
        Ok(summary)
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
                app_err!("配置中缺少 model_providers 段落，无法写入 API 端点/API Key")
            })?;
            payload.provider_body =
                Some(codex_config::update_provider_body(body, base_url, api_key)?);
        }
        // 快照优先并入数据库 MCP 镜像；首次使用时镜像为空才回退 live。
        payload.raw_config = Some(codex_config::without_managed_mcp_servers(
            &codex_config::merge_mcp_section(
                config_text.trim_end(),
                &self.mcp_document_for_new_profile()?,
            ),
        )?);
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
        let summary = profile_summary(&stored);
        tauri_plugin_log::log::info!(
            "[provider.profile.create] {} outcome=success msg=\"已创建配置\"",
            profile_subject(&summary)
        );
        Ok(summary)
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
        let stored = self.database.profile(id)?;
        let name = validated_name(name)?;
        self.database
            .rename_profile(id, &name, &now_ms().to_string())?;
        tauri_plugin_log::log::info!(
            "[provider.profile.rename] profile_id={id} profile_name={:?} new_name={name:?} outcome=success msg=\"已重命名配置\"",
            stored.name
        );
        Ok(())
    }

    pub fn reorder_profiles(&self, ids: &[String]) -> AppResult<()> {
        self.database.reorder_profiles(ids, &now_ms().to_string())
    }

    pub fn delete_profile(&self, id: &str) -> AppResult<()> {
        let stored = self.database.profile(id)?;
        self.database.delete_profile(id)?;
        if self.active_profile_state()?.as_deref() == Some(id) {
            self.database.set_active_profile(None)?;
        }
        // 删除清掉的是配置与本地凭据，留痕是唯一审计线索
        tauri_plugin_log::log::info!(
            "[provider.profile.delete] profile_id={id} profile_name={:?} outcome=success msg=\"已删除配置\"",
            stored.name
        );
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

    /// 保存最近一次成功获取的模型列表，避免编辑页每次打开都重复请求供应商接口。
    pub fn set_profile_fetched_models(&self, id: &str, models: Vec<String>) -> AppResult<()> {
        let stored = self.database.profile(id)?;
        let mut payload = stored.payload;
        payload.fetched_models = models;
        self.database
            .update_profile(id, &stored.name, &payload, &now_ms().to_string())
            .map(|_| ())
    }

    /// 完整复制供应商（配置、关联文件、图标、账号绑定），新供应商名加 `copy` 后缀，同名时追加序号。
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
        // 外部 Codex 官方认证属于全局订阅凭据，不并入第三方配置（避免副本应用时覆盖官方认证）。
        if active && stored.kind == ProfileKind::ThirdParty && stored.payload.raw_auth.is_none() {
            stored.payload.raw_auth = read_optional_text(&self.paths.codex_home.join("auth.json"))
                .filter(|text| parse_external_auth_json(text).is_none());
        }
        let profiles = self.database.profiles()?;
        let source_index = profiles
            .iter()
            .position(|profile| profile.id == id)
            .ok_or_else(|| app_err!("供应商配置不存在"))?;
        let base: String = stored.name.trim().chars().take(45).collect();
        let mut candidate = format!("{base} copy");
        let mut counter = 2;
        while profiles
            .iter()
            .any(|profile| profile.name.eq_ignore_ascii_case(&candidate))
        {
            candidate = format!("{base} copy {counter}");
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
        let mut ordered_ids: Vec<String> = profiles.into_iter().map(|profile| profile.id).collect();
        ordered_ids.insert(source_index + 1, summary.id.clone());
        self.database.reorder_profiles(&ordered_ids, &timestamp)?;
        self.database.record_event(
            Some(&summary.id),
            "duplicate",
            "success",
            Some("profile duplicated"),
            &timestamp,
        )?;
        tauri_plugin_log::log::info!(
            "[provider.profile.duplicate] source_profile_id={id} profile_id={} profile_name={candidate:?} source_profile_name={:?} outcome=success msg=\"已复制配置\"",
            summary.id,
            stored.name
        );
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
        let auth_source = payload.effective_auth_source(stored.kind, stored.account_id.as_deref());
        let desktop_login = if auth_source == Some(AuthSource::Desktop) {
            raw_auth
                .as_deref()
                .and_then(parse_external_auth_json)
                .map(|auth| auth.email.unwrap_or(auth.account_id))
        } else {
            None
        };

        Ok(ProfileDetail {
            id: stored.id.clone(),
            name: stored.name.clone(),
            account_id: stored.account_id.clone(),
            desktop_login,
            icon: stored.icon.clone(),
            provider: payload.provider_id.clone(),
            base_url: provider.as_ref().and_then(|detail| detail.base_url.clone()),
            api_key,
            model_values: payload.model_values.clone(),
            config_fragment,
            raw_config,
            auth_source,
            catalog_content,
            raw_catalog: payload.raw_catalog.clone(),
            raw_auth: if auth_source == Some(AuthSource::Desktop)
                || stored.kind == ProfileKind::ThirdParty
            {
                raw_auth
            } else {
                None
            },
            admin_url: payload.admin_url.clone(),
            show_balance: payload.show_balance,
            fetched_models: payload.fetched_models.clone(),
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
        let _operation = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        let stored = self.database.profile(id)?;
        let auth_source = stored
            .payload
            .effective_auth_source(stored.kind, stored.account_id.as_deref());
        if stored.kind == ProfileKind::Official
            && auth_source == Some(AuthSource::Oauth)
            && auth_text.is_some()
        {
            return Err(app_err!(
                "OAuth 配置的认证由账号选择管理，不能编辑 Desktop auth.json"
            ));
        }
        let mut payload = stored.payload;

        // 清空 auth 内容 = 移除配置级覆盖，恢复为账号自动凭据
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
            // 改写了内置供应商的 provider 身份后脱离内置模板，按完整配置快照应用
            payload.builtin = None;
        }
        payload.provider_id = parsed.provider_id;
        payload.model_values = parsed.model_values;
        payload.provider_body = parsed.provider_body;
        payload.raw_config = Some(codex_config::without_managed_mcp_servers(config_text)?);
        if catalog_text.is_some() {
            payload.raw_catalog = catalog_text.map(str::to_string);
        }
        if auth_text.is_some() {
            payload.raw_auth = auth_override.clone();
            // Desktop 清空 auth 是移除旧快照并等待下一次桌面认证；有内容才是手动接管。
            payload.auth_auto_sync = if auth_source == Some(AuthSource::Desktop) {
                Some(auth_override.is_none())
            } else {
                Some(false)
            };
        } else if auth_source == Some(AuthSource::Oauth) {
            payload.raw_auth = None;
            payload.auth_auto_sync = None;
        }
        self.database
            .update_profile(id, &stored.name, &payload, &now_ms().to_string())?;

        // 使用中：编辑内容立即写进当前 Codex 文件（是否生效由 Codex 重启决定）
        if self.is_active_profile(id)? {
            let config_path = self.paths.codex_config();
            let updated = self
                .live_document()
                .map(|live| codex_config::merge_mcp_section(config_text, &live))
                .unwrap_or_else(|| codex_config::normalize_global_section_order(config_text));
            backup_file(&config_path, &self.paths.config_backup, "config")?;
            atomic_write(&config_path, updated.as_bytes())?;
            if catalog_text.is_some() {
                self.write_raw_catalog(&payload)?;
            }
            if auth_text.is_some() {
                match normalize_auth_override(payload.raw_auth.as_deref()) {
                    Some(raw) => self.write_auth_json(&raw)?,
                    None => self.remove_raw_auth()?,
                }
            }
        }
        let mut fields = vec!["config"];
        if catalog_text.is_some() {
            fields.push("raw_catalog");
        }
        if auth_text.is_some() {
            fields.push("raw_auth");
        }
        tauri_plugin_log::log::info!(
            "[provider.profile.update] profile_id={id} profile_name={:?} fields={} outcome=success msg=\"已更新配置\"",
            stored.name,
            fields.join(",")
        );
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
            return Err(app_err!("该供应商缺少配置，无法修改 API 端点或 API Key"));
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
        let mut fields = Vec::new();
        if admin_url.is_some() {
            fields.push("admin_url");
        }
        if base_url.is_some() {
            fields.push("base_url");
        }
        if api_key.is_some() {
            fields.push("api_key");
        }
        tauri_plugin_log::log::info!(
            "[provider.profile.update] profile_id={id} profile_name={name:?} fields={} outcome=success msg=\"已更新配置\"",
            fields.join(",")
        );
        Ok(profile_summary(&updated))
    }
}
