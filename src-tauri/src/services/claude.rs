//! Claude Code 供应商：独立小引擎，把 base_url / token / model 注入 ~/.claude/settings.json 的 env。
//!
//! 供应商 env 与 Codex 的 config.toml 管线并行：不把 Claude 供应商字段塞进 Codex TOML，
//! 只复用 fsutil 的备份与原子写原语。MCP 是应用级共享配置，另投影到 Claude Code 的
//! 用户范围 ~/.claude.json；settings.json 这里只动三个托管键（MANAGED_ENV_KEYS）。

use std::path::PathBuf;

use serde::Deserialize;
use serde_json::{Map, Value};

use super::model_fetch::{ends_with_version_segment, redact, truncate_body, FETCH_TIMEOUT_SECS};
use super::plugins::SkillTool;
use super::AppContext;
use crate::codex::config as codex_config;
use crate::database::StoredClaudeProfile;
use crate::error::{app_err, AppResult};
use crate::fsutil::{atomic_write, backup_file};
use crate::models::{ClaudeProfileDetail, ClaudeProfileInput, ClaudeProfileSummary, McpServerSpec};
use crate::paths::now_ms;

/// CGswitch 托管的 env 键：应用/切换前先整体移除再写入，永不残留上一家的配置。
/// 顺序即写入顺序：base_url → token → model。
const MANAGED_ENV_KEYS: [&str; 3] = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_MODEL",
];

fn summary(profile: &StoredClaudeProfile) -> ClaudeProfileSummary {
    ClaudeProfileSummary {
        id: profile.id.clone(),
        name: profile.name.clone(),
        base_url: profile.base_url.clone(),
        has_token: profile
            .auth_token
            .as_deref()
            .is_some_and(|token| !token.is_empty()),
        model: profile.model.clone(),
        description: profile.description.clone(),
        icon: profile.icon.clone(),
        updated_at: profile.updated_at.clone(),
    }
}

fn detail(profile: StoredClaudeProfile) -> ClaudeProfileDetail {
    ClaudeProfileDetail {
        fetched_models: profile
            .fetched_models
            .as_deref()
            .and_then(|text| serde_json::from_str(text).ok())
            .unwrap_or_default(),
        id: profile.id,
        name: profile.name,
        base_url: profile.base_url,
        auth_token: profile.auth_token,
        model: profile.model,
        description: profile.description,
        kind: profile.kind,
        admin_url: profile.admin_url,
        extra_env: profile.extra_env,
        raw_settings: profile.raw_settings,
        icon: profile.icon,
        updated_at: profile.updated_at,
    }
}

fn clean(value: Option<String>) -> Option<String> {
    value.filter(|text| !text.trim().is_empty())
}

/// 校验附加 env：必须是字符串键值的 JSON 对象；空对象归一为 None（不落列）。
/// 保留用户原文（排版/键序），编辑往返稳定。
fn normalize_extra_env(raw: Option<String>) -> AppResult<Option<String>> {
    let Some(text) = clean(raw) else {
        return Ok(None);
    };
    let value: Value = serde_json::from_str(&text)
        .map_err(|error| app_err!("settings.json 附加 env 不是有效 JSON: {error}"))?;
    let Value::Object(map) = value else {
        return Err(app_err!("settings.json 附加 env 必须是 JSON 对象"));
    };
    if map.is_empty() {
        return Ok(None);
    }
    for (key, item) in &map {
        if !item.is_string() {
            return Err(app_err!("附加 env 的 {key} 值必须是字符串"));
        }
    }
    Ok(Some(text))
}

/// 附加 env 文本里的键列表：切换/删除/保存激活配置时随托管键一起从 live env 撤下，不残留上一家的键。
fn extra_env_keys(raw: Option<&str>) -> Vec<String> {
    raw.and_then(|text| serde_json::from_str::<Value>(text).ok())
        .and_then(|value| value.as_object().map(|map| map.keys().cloned().collect()))
        .unwrap_or_default()
}

fn read_raw_settings(raw: &str, input: &mut ClaudeProfileInput) -> AppResult<()> {
    let document: Value = serde_json::from_str(raw)
        .map_err(|error| app_err!("settings.json 不是有效 JSON: {error}"))?;
    let object = document
        .as_object()
        .ok_or_else(|| app_err!("settings.json 顶层必须是 JSON 对象"))?;
    let env = match object.get("env") {
        Some(value) => Some(
            value
                .as_object()
                .ok_or_else(|| app_err!("settings.json 的 env 必须是 JSON 对象"))?,
        ),
        None => None,
    };
    if let Some(env) = env {
        for (key, value) in env {
            if !value.is_string() {
                return Err(app_err!("settings.json 的 env.{key} 必须是字符串"));
            }
        }
    }
    let field = |key: &str| {
        env.and_then(|env| env.get(key))
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    input.base_url = field("ANTHROPIC_BASE_URL");
    input.auth_token = field("ANTHROPIC_AUTH_TOKEN");
    input.model = field("ANTHROPIC_MODEL");
    let extra: serde_json::Map<String, Value> = env
        .into_iter()
        .flat_map(|env| env.iter())
        .filter(|(key, _)| !MANAGED_ENV_KEYS.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    input.extra_env = (!extra.is_empty()).then(|| Value::Object(extra).to_string());
    Ok(())
}

fn legacy_matches_live(raw: &str, profile: &StoredClaudeProfile) -> bool {
    let mut current = ClaudeProfileInput::default();
    if read_raw_settings(raw, &mut current).is_err() {
        return false;
    }
    current.base_url == profile.base_url
        && current.auth_token == profile.auth_token
        && current.model == profile.model
        && current
            .extra_env
            .as_deref()
            .and_then(|text| serde_json::from_str::<Value>(text).ok())
            == profile
                .extra_env
                .as_deref()
                .and_then(|text| serde_json::from_str::<Value>(text).ok())
}

/// 把 Codex 镜像中的一个 MCP 片段转换成 Claude Code 用户范围的 JSON 条目。
/// Codex 与 Claude 的传输字段不同：HTTP 需要显式 type，http_headers 映射为 headers，
/// env_http_headers / bearer_token_env_var 映射为 Claude 支持的 ${VAR} 展开。
fn mcp_fragment_to_claude_entry(name: &str, fragment: &str) -> AppResult<Value> {
    let spec = codex_config::spec_from_fragment(name, fragment)
        .ok_or_else(|| app_err!("MCP 服务器 {name} 的共享片段无法解析"))?;
    let mut entry = Map::new();
    if let Some(command) = spec.command {
        entry.insert("type".into(), Value::String("stdio".into()));
        entry.insert("command".into(), Value::String(command));
    } else if let Some(url) = spec.url {
        entry.insert("type".into(), Value::String("http".into()));
        entry.insert("url".into(), Value::String(url));
        let mut headers = spec.http_headers;
        for (header, variable) in spec.env_http_headers {
            let variable = variable.trim();
            if !variable.is_empty() {
                headers.insert(header, format!("${{{variable}}}"));
            }
        }
        if let Some(variable) = spec.bearer_token_env_var {
            let variable = variable.trim();
            if !variable.is_empty() {
                headers
                    .entry("Authorization".into())
                    .or_insert_with(|| format!("Bearer ${{{variable}}}"));
            }
        }
        if !headers.is_empty() {
            entry.insert(
                "headers".into(),
                Value::Object(
                    headers
                        .into_iter()
                        .map(|(key, value)| (key, Value::String(value)))
                        .collect(),
                ),
            );
        }
    } else {
        return Err(app_err!("MCP 服务器 {name} 没有可用的 command 或 url"));
    }
    if !spec.args.is_empty() {
        entry.insert(
            "args".into(),
            Value::Array(spec.args.into_iter().map(Value::String).collect()),
        );
    }
    if !spec.env.is_empty() {
        entry.insert(
            "env".into(),
            Value::Object(
                spec.env
                    .into_iter()
                    .map(|(key, value)| (key, Value::String(value)))
                    .collect(),
            ),
        );
    }
    Ok(Value::Object(entry))
}

fn claude_string_map(
    value: Option<&Value>,
    field: &str,
) -> AppResult<std::collections::BTreeMap<String, String>> {
    let Some(value) = value else {
        return Ok(std::collections::BTreeMap::new());
    };
    let object = value
        .as_object()
        .ok_or_else(|| app_err!("Claude MCP 的 {field} 必须是对象"))?;
    object
        .iter()
        .map(|(key, value)| {
            value
                .as_str()
                .map(|value| (key.clone(), value.to_string()))
                .ok_or_else(|| app_err!("Claude MCP 的 {field}.{key} 必须是字符串"))
        })
        .collect()
}

/// 将 Claude Code 的 mcpServers 条目转成共享数据库使用的建模字段。
fn claude_entry_to_spec(name: &str, value: &Value) -> AppResult<McpServerSpec> {
    let object = value
        .as_object()
        .ok_or_else(|| app_err!("Claude MCP 服务器 {name} 必须是对象"))?;
    let command = object
        .get("command")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let url = object.get("url").and_then(Value::as_str).map(str::to_owned);
    if command.is_some() == url.is_some() {
        return Err(app_err!(
            "Claude MCP 服务器 {name} 必须且只能包含 command 或 url"
        ));
    }
    let args = match object.get("args") {
        None => Vec::new(),
        Some(Value::Array(values)) => values
            .iter()
            .map(|value| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| app_err!("Claude MCP 的 args 必须全部是字符串"))
            })
            .collect::<AppResult<Vec<_>>>()?,
        Some(_) => return Err(app_err!("Claude MCP 的 args 必须是数组")),
    };
    let env = claude_string_map(object.get("env"), "env")?;
    let headers = claude_string_map(object.get("headers"), "headers")?;
    let mut http_headers = std::collections::BTreeMap::new();
    let mut env_http_headers = std::collections::BTreeMap::new();
    let mut bearer_token_env_var = None;
    for (key, value) in headers {
        if let Some(variable) = value
            .strip_prefix("Bearer ${")
            .and_then(|value| value.strip_suffix('}'))
        {
            if key.eq_ignore_ascii_case("authorization") {
                bearer_token_env_var = Some(variable.to_string());
                continue;
            }
        }
        if let Some(variable) = value
            .strip_prefix("${")
            .and_then(|value| value.strip_suffix('}'))
        {
            env_http_headers.insert(key, variable.to_string());
        } else {
            http_headers.insert(key, value);
        }
    }
    Ok(McpServerSpec {
        name: name.to_string(),
        enabled: None,
        startup_timeout_sec: None,
        tool_timeout_sec: None,
        command,
        args,
        env,
        url,
        bearer_token_env_var,
        http_headers,
        env_http_headers,
    })
}

impl AppContext {
    fn claude_settings_path(&self) -> PathBuf {
        self.paths.claude_home.join("settings.json")
    }

    fn read_claude_mcp_document(&self) -> AppResult<Value> {
        let path = self.paths.claude_mcp_config();
        match std::fs::read_to_string(&path) {
            Ok(text) if text.trim().is_empty() => Ok(Value::Object(Map::new())),
            Ok(text) => serde_json::from_str(&text)
                .map_err(|error| app_err!(".claude.json 不是有效 JSON，拒绝写入: {error}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(Value::Object(Map::new()))
            }
            Err(error) => Err(app_err!("无法读取 {}: {error}", path.display())),
        }
    }

    fn write_claude_mcp_document(&self, document: &Value) -> AppResult<()> {
        let path = self.paths.claude_mcp_config();
        backup_file(&path, &self.paths.config_backup, "claude-mcp")?;
        let mut bytes = serde_json::to_vec_pretty(document)
            .map_err(|error| app_err!(".claude.json 序列化失败: {error}"))?;
        bytes.push(b'\n');
        atomic_write(&path, &bytes)
    }

    /// 把全局 MCP 镜像同步到 Claude Code 的用户范围配置。
    /// 只更新 CGswitch 当前镜像中的名称；其他用户范围服务器、项目配置和顶层字段原样保留。
    pub(super) fn sync_claude_mcp_projection(
        &self,
        previous: &[(String, String)],
        current: &[(String, String)],
    ) -> AppResult<()> {
        if previous.is_empty() && current.is_empty() {
            return Ok(());
        }
        let previous: std::collections::BTreeMap<_, _> = previous
            .iter()
            .filter(|(name, _)| !codex_config::is_managed_mcp_name(name))
            .filter_map(|(name, fragment)| {
                mcp_fragment_to_claude_entry(name, fragment)
                    .ok()
                    .map(|entry| (name.clone(), entry))
            })
            .collect();
        let current: std::collections::BTreeMap<_, _> = current
            .iter()
            .filter(|(name, _)| !codex_config::is_managed_mcp_name(name))
            .map(|(name, fragment)| {
                Ok((name.clone(), mcp_fragment_to_claude_entry(name, fragment)?))
            })
            .collect::<AppResult<_>>()?;
        let mut document = self.read_claude_mcp_document()?;
        let object = document
            .as_object_mut()
            .ok_or_else(|| app_err!(".claude.json 顶层不是对象，拒绝写入"))?;
        let had_mcp_servers = object.contains_key("mcpServers");
        let mcp_servers = object
            .entry("mcpServers")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .ok_or_else(|| app_err!(".claude.json 的 mcpServers 不是对象，拒绝写入"))?;
        let mut changed = false;
        for (name, expected) in &previous {
            if !current.contains_key(name) && mcp_servers.get(name) == Some(expected) {
                mcp_servers.remove(name);
                changed = true;
            }
        }
        for (name, entry) in &current {
            if mcp_servers.get(name) != Some(entry) {
                mcp_servers.insert(name.clone(), entry.clone());
                changed = true;
            }
        }
        if !changed {
            return Ok(());
        }
        if mcp_servers.is_empty() && !had_mcp_servers {
            object.remove("mcpServers");
        }
        self.write_claude_mcp_document(&document)
    }

    /// 应用级开关关闭时无条件移除用户范围条目；项目级配置不在这里触碰。
    pub(super) fn remove_claude_mcp_entry(&self, name: &str) -> AppResult<()> {
        let mut document = self.read_claude_mcp_document()?;
        let Some(servers) = document
            .get_mut("mcpServers")
            .and_then(Value::as_object_mut)
        else {
            return Ok(());
        };
        if servers.remove(name).is_some() {
            self.write_claude_mcp_document(&document)?;
        }
        Ok(())
    }

    /// 读取 .claude.json 用户范围条目并转为共享片段（滤除托管名与解析失败项）。
    pub(super) fn claude_mcp_fragments_from_live(&self) -> AppResult<Vec<(String, String)>> {
        let document = self.read_claude_mcp_document()?;
        let Some(servers) = document.get("mcpServers").and_then(Value::as_object) else {
            return Ok(Vec::new());
        };
        Ok(servers
            .iter()
            .filter(|(name, _)| !codex_config::is_managed_mcp_name(name))
            .filter_map(|(name, value)| {
                let spec = claude_entry_to_spec(name, value).ok()?;
                let fragment = codex_config::patch_mcp_fragment("", &spec).ok()?;
                Some((name.clone(), fragment))
            })
            .collect())
    }

    /// DB 镜像为空时首次从 Codex live MCP 导入；之后始终以数据库镜像为共享源。
    /// 投影只含 Claude 开关打开的条目；Claude 关闭的条目从 .claude.json 撤下、片段留在镜像。
    pub(super) fn ensure_claude_mcp_projection(&self) -> AppResult<()> {
        let records = self.database.mcp_server_records()?;
        if !records.is_empty() {
            let all: Vec<(String, String)> = records
                .iter()
                .map(|record| (record.name.clone(), record.toml.clone()))
                .collect();
            return self.sync_claude_mcp_projection(&all, &Self::claude_active_fragments(&records));
        }
        if let Ok(document) = codex_config::parse_document(&self.read_live_config()?) {
            let live = codex_config::mcp_server_fragments_from_document(&document);
            if !live.is_empty() {
                return self.replace_mcp_mirror(&live);
            }
        }
        let fragments = self.claude_mcp_fragments_from_live()?;
        if !fragments.is_empty() {
            self.database
                .replace_mcp_server_fragments(&fragments, &now_ms().to_string())?;
        }
        Ok(())
    }

    pub fn claude_mcp_servers(&self) -> AppResult<Vec<McpServerSpec>> {
        self.ensure_claude_mcp_projection()?;
        let document = self.read_claude_mcp_document()?;
        let servers = document.get("mcpServers").and_then(Value::as_object);
        let records = self.database.mcp_server_records()?;
        let mut result = servers
            .into_iter()
            .flat_map(|servers| servers.iter())
            .filter(|(name, _)| !codex_config::is_managed_mcp_name(name))
            .map(|(name, value)| claude_entry_to_spec(name, value))
            .collect::<AppResult<Vec<_>>>()?;
        for record in records {
            if record.claude_enabled {
                continue;
            }
            if let Some(server) = result.iter_mut().find(|server| server.name == record.name) {
                server.enabled = Some(false);
                continue;
            }
            if let Some(mut server) = codex_config::spec_from_fragment(&record.name, &record.toml) {
                server.enabled = Some(false);
                result.push(server);
            }
        }
        result.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(result)
    }

    pub fn claude_mcp_server_json(&self, name: &str) -> AppResult<Option<String>> {
        self.ensure_claude_mcp_projection()?;
        if let Some(record) = self.database.mcp_server_record(name)? {
            if !record.claude_enabled {
                let entry = mcp_fragment_to_claude_entry(name, &record.toml)?;
                return serde_json::to_string_pretty(&entry)
                    .map(Some)
                    .map_err(|error| app_err!("Claude MCP JSON 序列化失败: {error}"));
            }
        }
        let document = self.read_claude_mcp_document()?;
        if let Some(entry) = document
            .get("mcpServers")
            .and_then(Value::as_object)
            .and_then(|servers| servers.get(name))
        {
            return serde_json::to_string_pretty(entry)
                .map(Some)
                .map_err(|error| app_err!("Claude MCP JSON 序列化失败: {error}"));
        }
        Ok(None)
    }

    pub fn save_claude_mcp_server(
        &self,
        original_name: Option<&str>,
        name: &str,
        json: &str,
    ) -> AppResult<()> {
        let name = name.trim();
        if name.is_empty()
            || name.len() > 64
            || !name
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            return Err(app_err!(
                "MCP 名称只能包含字母、数字、下划线和连字符，且最多 64 字符"
            ));
        }
        if codex_config::is_managed_mcp_name(name) {
            return Err(app_err!(
                "「{name}」由 Codex 官方应用自动管理，不能在本应用中创建或编辑"
            ));
        }
        let entry: Value = serde_json::from_str(json)
            .map_err(|error| app_err!("Claude MCP JSON 无效: {error}"))?;
        let spec = claude_entry_to_spec(name, &entry)?;
        let before = self.read_claude_mcp_document()?;
        let servers = before
            .as_object()
            .and_then(|object| object.get("mcpServers"))
            .and_then(Value::as_object);
        if original_name != Some(name) && servers.is_some_and(|servers| servers.contains_key(name))
        {
            return Err(app_err!("已存在同名 Claude MCP 服务器"));
        }
        self.save_mcp_server_with_fragment(original_name, spec, None, SkillTool::Claude)?;
        let mut document = self.read_claude_mcp_document()?;
        let object = document
            .as_object_mut()
            .ok_or_else(|| app_err!(".claude.json 顶层不是对象，拒绝写入"))?;
        let mcp_servers = object
            .entry("mcpServers")
            .or_insert_with(|| Value::Object(Map::new()))
            .as_object_mut()
            .ok_or_else(|| app_err!(".claude.json 的 mcpServers 不是对象，拒绝写入"))?;
        if let Some(original) = original_name.filter(|original| *original != name) {
            mcp_servers.remove(original);
        }
        mcp_servers.insert(name.to_string(), entry);
        self.write_claude_mcp_document(&document)
    }

    pub fn delete_claude_mcp_server(&self, name: &str) -> AppResult<()> {
        self.delete_mcp_server(name)
    }

    pub fn claude_list(&self) -> AppResult<Vec<ClaudeProfileSummary>> {
        Ok(self
            .database
            .claude_profiles()?
            .iter()
            .map(summary)
            .collect())
    }

    pub fn claude_get(&self, id: &str) -> AppResult<ClaudeProfileDetail> {
        let mut stored = self.database.claude_profile(id)?;
        if stored.raw_settings.is_none() {
            if let Ok(raw) = std::fs::read_to_string(self.claude_settings_path()) {
                if legacy_matches_live(&raw, &stored) {
                    stored.raw_settings = Some(raw);
                }
            }
        }
        Ok(detail(stored))
    }

    /// 捕获完整 settings.json，不改变 live 文件。
    pub fn claude_capture(&self, name: &str) -> AppResult<ClaudeProfileDetail> {
        let text = std::fs::read_to_string(self.claude_settings_path())
            .map_err(|error| app_err!("读取 Claude settings.json 失败: {error}"))?;
        self.claude_save(
            None,
            ClaudeProfileInput {
                name: name.to_string(),
                raw_settings: Some(text),
                ..Default::default()
            },
        )
    }

    /// 新增或更新；更新的是激活中的配置时，立即重写 live settings.json（对齐 Codex 侧编辑即生效的语义）。
    /// kind/admin_url 记录创建时的预设来源（对齐 Codex payload.builtin），编辑页靠 kind 反查端点档。
    pub fn claude_save(
        &self,
        id: Option<&str>,
        mut input: ClaudeProfileInput,
    ) -> AppResult<ClaudeProfileDetail> {
        if let Some(raw) = input.raw_settings.clone() {
            read_raw_settings(&raw, &mut input)?;
        }
        input.name = input.name.trim().to_string();
        if input.name.is_empty() {
            return Err(app_err!("配置名称不能为空"));
        }
        input.base_url = clean(input.base_url);
        input.auth_token = clean(input.auth_token);
        input.model = clean(input.model);
        input.description = clean(input.description);
        input.kind = clean(input.kind);
        input.admin_url = clean(input.admin_url);
        input.icon = clean(input.icon);
        input.fetched_models = match input.fetched_models {
            Some(models) if !models.is_empty() => Some(models),
            _ => None,
        };
        input.extra_env = normalize_extra_env(input.extra_env.take())?;
        let timestamp = now_ms().to_string();
        let stored = match id {
            Some(id) => {
                let is_active = self.database.active_claude_profile()?.as_deref() == Some(id);
                // 激活中的配置被改写：旧附加 env 的键也要从 live 撤下，避免残留上一版的自定义键
                let stale_extra_keys = if is_active {
                    extra_env_keys(
                        self.database
                            .claude_profile(id)
                            .ok()
                            .and_then(|profile| profile.extra_env)
                            .as_deref(),
                    )
                } else {
                    Vec::new()
                };
                let updated = self
                    .database
                    .update_claude_profile(id, &input, &timestamp)?;
                if is_active {
                    self.write_claude_settings(Some(&updated), &stale_extra_keys)?;
                }
                updated
            }
            None => self.database.insert_claude_profile(&input, &timestamp)?,
        };
        Ok(detail(stored))
    }

    /// 更换图标（对齐 Codex set_profile_icon：同一 validated_icon 白名单校验，立即落库不经保存）。
    pub fn claude_set_icon(&self, id: &str, icon: Option<String>) -> AppResult<()> {
        let icon = super::profiles::validated_icon(icon.as_deref())?;
        self.database
            .set_claude_profile_icon(id, icon.as_deref(), &now_ms().to_string())
    }

    pub fn claude_reorder(&self, ids: &[String]) -> AppResult<()> {
        self.database
            .reorder_claude_profiles(ids, &now_ms().to_string())
    }

    /// 卡片上的测试连通：用已存的凭证打一次 /models，成功回传耗时（对齐 Codex 卡片测试按钮）。
    pub async fn claude_test_profile(&self, id: &str) -> AppResult<u64> {
        let stored = self.database.claude_profile(id)?;
        let base_url = stored
            .base_url
            .filter(|text| !text.trim().is_empty())
            .ok_or_else(|| app_err!("请先填写 API 地址"))?;
        let auth_token = stored
            .auth_token
            .filter(|text| !text.trim().is_empty())
            .ok_or_else(|| app_err!("请先填写 API Token"))?;
        let started_at = std::time::Instant::now();
        fetch_claude_models(&base_url, &auth_token).await?;
        Ok(started_at.elapsed().as_millis() as u64)
    }

    /// 完整复制配置（列值、图标、附加 env），新名称加 `copy` 后缀、同名追加序号，插到源卡片后面（对齐 Codex duplicate_profile）。
    pub fn claude_duplicate(&self, id: &str) -> AppResult<ClaudeProfileDetail> {
        let stored = self.database.claude_profile(id)?;
        let profiles = self.database.claude_profiles()?;
        let source_index = profiles
            .iter()
            .position(|profile| profile.id == id)
            .ok_or_else(|| app_err!("Claude 供应商配置不存在"))?;
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
        let created = self.database.insert_claude_profile(
            &ClaudeProfileInput {
                name: candidate,
                base_url: stored.base_url.clone(),
                auth_token: stored.auth_token.clone(),
                model: stored.model.clone(),
                description: stored.description.clone(),
                fetched_models: stored
                    .fetched_models
                    .as_deref()
                    .and_then(|text| serde_json::from_str(text).ok()),
                kind: stored.kind.clone(),
                admin_url: stored.admin_url.clone(),
                extra_env: stored.extra_env.clone(),
                raw_settings: stored.raw_settings.clone(),
                icon: stored.icon.clone(),
            },
            &timestamp,
        )?;
        let mut ordered_ids: Vec<String> = profiles.into_iter().map(|profile| profile.id).collect();
        ordered_ids.insert(source_index + 1, created.id.clone());
        self.database
            .reorder_claude_profiles(&ordered_ids, &timestamp)?;
        Ok(detail(created))
    }

    pub fn claude_delete(&self, id: &str) -> AppResult<()> {
        let was_active = self.database.active_claude_profile()?.as_deref() == Some(id);
        // 删除前先取一行：激活时它的附加 env 键也要从 live 撤下
        let stored = self.database.claude_profile(id)?;
        self.database.delete_claude_profile(id)?;
        if was_active {
            // 删除激活中的配置：把托管键与它的附加键从 live 撤下，回到无供应商状态
            self.write_claude_settings(None, &extra_env_keys(stored.extra_env.as_deref()))?;
            self.database.set_active_claude_profile(None)?;
            tauri_plugin_log::log::info!(
                "[apply.claude.delete] profile_id={id} outcome=success msg=\"激活配置已删除，env 托管键已撤下\""
            );
        }
        Ok(())
    }

    pub fn claude_apply(&self, id: &str) -> AppResult<()> {
        let stored = self.database.claude_profile(id)?;
        // 上一家激活配置的附加键一并撤下：托管键之外也不残留
        let stale_extra_keys = match self.database.active_claude_profile()? {
            Some(previous) if previous != id => extra_env_keys(
                self.database
                    .claude_profile(&previous)
                    .ok()
                    .and_then(|profile| profile.extra_env)
                    .as_deref(),
            ),
            _ => Vec::new(),
        };
        // MCP 是全局用户范围配置，应用供应商时确保共享镜像已投影到 ~/.claude.json。
        self.ensure_claude_mcp_projection()?;
        self.write_claude_settings(Some(&stored), &stale_extra_keys)?;
        self.database.set_active_claude_profile(Some(id))?;
        self.database.record_event(
            None,
            "apply_claude",
            "success",
            Some(&format!("profile_id={id} profile_name={:?}", stored.name)),
            &now_ms().to_string(),
        )?;
        tauri_plugin_log::log::info!(
            "[apply.claude] profile_id={id} outcome=success msg=\"已写入 ~/.claude/settings.json\""
        );
        Ok(())
    }

    /// 恢复数据库后把 live settings.json 收敛到恢复出的激活位（回到备份时刻的状态）：
    /// 恢复出激活行 → 撤下恢复前激活的附加键再应用新行；恢复后无激活 → 只撤下恢复前激活留下的键。
    /// 恢复前后都没有激活配置时不触碰 live（可能是从未经由本应用的手写配置，不能误清）。
    pub(super) fn reconcile_claude_live_after_restore(
        &self,
        previous: Option<&StoredClaudeProfile>,
        next: Option<&StoredClaudeProfile>,
    ) -> AppResult<()> {
        if previous.is_none() && next.is_none() {
            return Ok(());
        }
        let remove_extra_keys = previous
            .map(|profile| extra_env_keys(profile.extra_env.as_deref()))
            .unwrap_or_default();
        self.write_claude_settings(next, &remove_extra_keys)
    }

    /// 全文快照直接恢复原文；旧配置继续只合并 env。
    /// values=None 表示纯撤下（删除激活配置）。
    /// 文件不存在则从空对象起建，存在但不是合法 JSON / 顶层不是对象时拒绝写入，绝不覆盖。
    fn write_claude_settings(
        &self,
        values: Option<&StoredClaudeProfile>,
        remove_extra_keys: &[String],
    ) -> AppResult<()> {
        let path = self.claude_settings_path();
        backup_file(&path, &self.paths.config_backup, "claude-settings")?;
        if let Some(raw) = values.and_then(|profile| profile.raw_settings.as_deref()) {
            let mut checked = ClaudeProfileInput::default();
            read_raw_settings(raw, &mut checked)?;
            return atomic_write(&path, raw.as_bytes());
        }
        let mut document: Value = match std::fs::read_to_string(&path) {
            Ok(text) if text.trim().is_empty() => Value::Object(serde_json::Map::new()),
            Ok(text) => {
                let value: Value = serde_json::from_str(&text)
                    .map_err(|error| app_err!("settings.json 不是有效 JSON，拒绝写入: {error}"))?;
                if !value.is_object() {
                    return Err(app_err!("settings.json 顶层不是对象，拒绝写入"));
                }
                value
            }
            Err(_) => Value::Object(serde_json::Map::new()),
        };
        {
            let object = document.as_object_mut().expect("顶层已校验为对象");
            let env = object
                .entry("env")
                .or_insert_with(|| Value::Object(serde_json::Map::new()));
            if !env.is_object() {
                return Err(app_err!("settings.json 的 env 不是对象，拒绝写入"));
            }
            let env = env.as_object_mut().expect("env 已校验为对象");
            for key in MANAGED_ENV_KEYS {
                env.remove(key);
            }
            for key in remove_extra_keys {
                env.remove(key);
            }
            if let Some(profile) = values {
                for (key, value) in MANAGED_ENV_KEYS.iter().zip([
                    profile.base_url.as_deref(),
                    profile.auth_token.as_deref(),
                    profile.model.as_deref(),
                ]) {
                    if let Some(text) = value.filter(|text| !text.trim().is_empty()) {
                        env.insert((*key).to_string(), Value::String(text.to_string()));
                    }
                }
                // 附加 env 在保存时已校验为对象；手改数据库的坏值在此静默跳过
                if let Some(Ok(Value::Object(extra))) = profile
                    .extra_env
                    .as_deref()
                    .map(serde_json::from_str::<Value>)
                {
                    for (key, value) in extra {
                        env.insert(key, value);
                    }
                }
            }
        }
        let mut bytes = serde_json::to_vec_pretty(&document)
            .map_err(|error| app_err!("settings.json 序列化失败: {error}"))?;
        bytes.push(b'\n');
        atomic_write(&path, &bytes)
    }
}

/// Anthropic 兼容的 /models 响应格式（官方与主流中转同形：data[].id）。
#[derive(Debug, Deserialize)]
struct ClaudeModelsResponse {
    data: Option<Vec<ClaudeModelEntry>>,
}

#[derive(Debug, Deserialize)]
struct ClaudeModelEntry {
    id: String,
}

/// 拉取 Anthropic 兼容端点的模型列表：base_url 无版本段 → `{base}/v1/models`；
/// 带 `/v{N}` 版本段 → `{base}/models`。脱敏/截断/版本段判断复用 model_fetch 的原语。
pub async fn fetch_claude_models(base_url: &str, auth_token: &str) -> AppResult<Vec<String>> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(app_err!("API 端点为空"));
    }
    if auth_token.trim().is_empty() {
        return Err(app_err!("请先填写 API Token 再获取模型列表"));
    }
    let url = if ends_with_version_segment(trimmed) {
        format!("{trimmed}/models")
    } else {
        format!("{trimmed}/v1/models")
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(FETCH_TIMEOUT_SECS))
        .build()
        .map_err(|error| app_err!("构建 HTTP 客户端失败: {error}"))?;
    let response = client
        .get(&url)
        .header("x-api-key", auth_token)
        .header("anthropic-version", "2023-06-01")
        .bearer_auth(auth_token)
        .send()
        .await
        .map_err(|error| app_err!("请求失败: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(app_err!(
            "HTTP {status}: {}",
            truncate_body(redact(&body, auth_token))
        ));
    }
    let parsed: ClaudeModelsResponse = response
        .json()
        .await
        .map_err(|error| app_err!("响应解析失败: {error}"))?;
    let mut models: Vec<String> = parsed
        .data
        .unwrap_or_default()
        .into_iter()
        .map(|entry| entry.id)
        .collect();
    models.sort();
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::plugins::test_context;

    fn read_settings(home: &tempfile::TempDir) -> Value {
        serde_json::from_str(
            &std::fs::read_to_string(home.path().join(".claude/settings.json")).unwrap(),
        )
        .unwrap()
    }

    fn read_claude_mcp(home: &tempfile::TempDir) -> Value {
        serde_json::from_str(&std::fs::read_to_string(home.path().join(".claude.json")).unwrap())
            .unwrap()
    }

    #[test]
    fn native_claude_mcp_entry_maps_to_shared_spec() {
        let entry = serde_json::json!({
            "type": "http",
            "url": "https://mcp.example.test",
            "headers": {
                "Authorization": "Bearer ${MCP_TOKEN}",
                "X-Workspace": "${MCP_WORKSPACE}",
                "X-Fixed": "value"
            }
        });
        let spec = claude_entry_to_spec("remote", &entry).unwrap();

        assert_eq!(spec.name, "remote");
        assert_eq!(spec.url.as_deref(), Some("https://mcp.example.test"));
        assert_eq!(spec.bearer_token_env_var.as_deref(), Some("MCP_TOKEN"));
        assert_eq!(
            spec.env_http_headers.get("X-Workspace"),
            Some(&"MCP_WORKSPACE".to_string())
        );
        assert_eq!(spec.http_headers.get("X-Fixed"), Some(&"value".to_string()));
    }

    fn draft(
        name: &str,
        base_url: Option<&str>,
        auth_token: Option<&str>,
        model: Option<&str>,
    ) -> ClaudeProfileInput {
        ClaudeProfileInput {
            name: name.to_string(),
            base_url: base_url.map(str::to_string),
            auth_token: auth_token.map(str::to_string),
            model: model.map(str::to_string),
            ..Default::default()
        }
    }

    #[test]
    fn capture_reads_live_env_without_changing_settings() {
        let (home, context) = test_context();
        let settings = home.path().join(".claude/settings.json");
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        let original = r#"{"model":"opus","permissions":{"allow":["Read"]},"env":{"ANTHROPIC_BASE_URL":"https://relay.example","ANTHROPIC_AUTH_TOKEN":"tok","ANTHROPIC_MODEL":"glm","CUSTOM":"keep"}}"#;
        std::fs::write(&settings, original).unwrap();

        let captured = context.claude_capture("现有配置").unwrap();
        assert_eq!(captured.base_url.as_deref(), Some("https://relay.example"));
        assert_eq!(captured.auth_token.as_deref(), Some("tok"));
        assert_eq!(captured.model.as_deref(), Some("glm"));
        assert_eq!(captured.extra_env.as_deref(), Some(r#"{"CUSTOM":"keep"}"#));
        assert_eq!(captured.raw_settings.as_deref(), Some(original));
        assert_eq!(std::fs::read_to_string(settings).unwrap(), original);
        assert_eq!(context.database.claude_profiles().unwrap().len(), 1);
        assert_eq!(context.database.active_claude_profile().unwrap(), None);
        context.claude_apply(&captured.id).unwrap();
        assert_eq!(read_settings(&home)["permissions"]["allow"][0], "Read");
        assert_eq!(
            std::fs::read_to_string(home.path().join(".claude/settings.json")).unwrap(),
            original
        );
    }

    #[test]
    fn full_settings_edit_updates_top_level_and_managed_fields() {
        let (home, context) = test_context();
        let raw = r#"{"model":"sonnet","permissions":{"allow":["Read"]},"env":{"ANTHROPIC_BASE_URL":"https://relay.example","ANTHROPIC_AUTH_TOKEN":"tok"}}"#;
        let created = context
            .claude_save(
                None,
                ClaudeProfileInput {
                    name: "A".into(),
                    raw_settings: Some(raw.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(created.raw_settings.as_deref(), Some(raw));
        assert_eq!(created.base_url.as_deref(), Some("https://relay.example"));
        context.claude_apply(&created.id).unwrap();

        let edited = r#"{"model":"opus","permissions":{"allow":["Write"]},"env":{"ANTHROPIC_BASE_URL":"https://other.example"}}"#;
        let saved = context
            .claude_save(
                Some(&created.id),
                ClaudeProfileInput {
                    name: "A".into(),
                    raw_settings: Some(edited.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(saved.auth_token, None);
        assert_eq!(saved.base_url.as_deref(), Some("https://other.example"));
        assert_eq!(
            std::fs::read_to_string(home.path().join(".claude/settings.json")).unwrap(),
            edited
        );
        assert!(context
            .claude_save(
                Some(&created.id),
                ClaudeProfileInput {
                    name: "A".into(),
                    raw_settings: Some(r#"{"env":{"BAD":1}}"#.into()),
                    ..Default::default()
                }
            )
            .is_err());
        assert_eq!(
            context
                .claude_get(&created.id)
                .unwrap()
                .raw_settings
                .as_deref(),
            Some(edited)
        );
    }

    #[test]
    fn legacy_snapshot_uses_full_live_file_only_when_env_matches() {
        let (home, context) = test_context();
        let settings = home.path().join(".claude/settings.json");
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        let raw =
            r#"{"model":"opus","env":{"ANTHROPIC_BASE_URL":"https://a.example","CUSTOM":"keep"}}"#;
        std::fs::write(&settings, raw).unwrap();
        let stored = context
            .claude_save(
                None,
                ClaudeProfileInput {
                    name: "旧快照".into(),
                    base_url: Some("https://a.example".into()),
                    extra_env: Some("{\"CUSTOM\": \"keep\"}".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(
            context
                .claude_get(&stored.id)
                .unwrap()
                .raw_settings
                .as_deref(),
            Some(raw)
        );
        std::fs::write(
            &settings,
            r#"{"model":"other","env":{"ANTHROPIC_BASE_URL":"https://b.example"}}"#,
        )
        .unwrap();
        assert_eq!(context.claude_get(&stored.id).unwrap().raw_settings, None);
    }

    #[test]
    fn apply_merges_env_and_preserves_other_keys() {
        let (home, context) = test_context();
        let settings = home.path().join(".claude/settings.json");
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        std::fs::write(
            &settings,
            r#"{"model":"opus","env":{"ANTHROPIC_AUTH_TOKEN":"old","CUSTOM":"keep"}}"#,
        )
        .unwrap();

        let stored = context
            .database
            .insert_claude_profile(
                &draft(
                    "BigModel",
                    Some("https://relay.example"),
                    Some("tok"),
                    Some("glm-5.3"),
                ),
                "1700000000000",
            )
            .unwrap();
        context.claude_apply(&stored.id).unwrap();

        let doc = read_settings(&home);
        assert_eq!(doc["model"], "opus");
        assert_eq!(doc["env"]["CUSTOM"], "keep");
        assert_eq!(doc["env"]["ANTHROPIC_BASE_URL"], "https://relay.example");
        assert_eq!(doc["env"]["ANTHROPIC_AUTH_TOKEN"], "tok");
        assert_eq!(doc["env"]["ANTHROPIC_MODEL"], "glm-5.3");
        assert_eq!(
            context.database.active_claude_profile().unwrap().as_deref(),
            Some(stored.id.as_str())
        );
    }

    #[test]
    fn apply_projects_global_mcp_and_keeps_unmanaged_claude_config() {
        let (home, context) = test_context();
        std::fs::create_dir_all(&context.paths.codex_home).unwrap();
        std::fs::write(
            context.paths.codex_config(),
            r#"
[mcp_servers.remote]
url = "https://mcp.example.com/mcp"

[mcp_servers.remote.http_headers]
Authorization = "Bearer token"

[mcp_servers.local]
command = "node"
args = ["server.js"]

[mcp_servers.local.env]
API_KEY = "secret"
"#,
        )
        .unwrap();
        std::fs::write(
            context.paths.claude_mcp_config(),
            r#"{"other":"keep","mcpServers":{"unmanaged":{"type":"stdio","command":"keep"}},"projects":{"/p":{"mcpServers":{"local-only":{"type":"stdio","command":"local"}}}}}"#,
        )
        .unwrap();
        let stored = context
            .database
            .insert_claude_profile(
                &draft("A", Some("https://relay.example"), Some("tok"), None),
                "1",
            )
            .unwrap();

        context.claude_apply(&stored.id).unwrap();

        let doc = read_claude_mcp(&home);
        assert_eq!(doc["other"], "keep");
        assert_eq!(doc["mcpServers"]["unmanaged"]["command"], "keep");
        assert_eq!(doc["mcpServers"]["remote"]["type"], "http");
        assert_eq!(
            doc["mcpServers"]["remote"]["url"],
            "https://mcp.example.com/mcp"
        );
        assert_eq!(
            doc["mcpServers"]["remote"]["headers"]["Authorization"],
            "Bearer token"
        );
        assert_eq!(doc["mcpServers"]["local"]["type"], "stdio");
        assert_eq!(doc["mcpServers"]["local"]["args"][0], "server.js");
        assert_eq!(
            doc["projects"]["/p"]["mcpServers"]["local-only"]["command"],
            "local"
        );

        context.delete_mcp_server("remote").unwrap();
        let doc = read_claude_mcp(&home);
        assert!(doc["mcpServers"].get("remote").is_none());
        assert!(doc["mcpServers"].get("unmanaged").is_some());
    }

    /// .claude.json 损坏 / 顶层或 mcpServers 不是对象：投影一律拒绝写入，原文件字节不动。
    /// 每次用不同服务器名：失败的保存已更新过镜像，同名重试会因 previous == current 跳过同步。
    #[test]
    fn claude_mcp_projection_refuses_malformed_claude_json() {
        fn stdio_spec(name: &str) -> McpServerSpec {
            McpServerSpec {
                name: name.to_string(),
                command: Some("node".to_string()),
                ..Default::default()
            }
        }
        let (home, context) = test_context();
        std::fs::create_dir_all(&context.paths.codex_home).unwrap();
        std::fs::write(context.paths.codex_config(), "").unwrap();
        let claude_json = home.path().join(".claude.json");

        std::fs::write(&claude_json, "not json {").unwrap();
        assert!(context.save_mcp_server(None, stdio_spec("srv1")).is_err());
        assert_eq!(std::fs::read_to_string(&claude_json).unwrap(), "not json {");

        std::fs::write(&claude_json, "[1,2]").unwrap();
        assert!(context.save_mcp_server(None, stdio_spec("srv2")).is_err());
        assert_eq!(std::fs::read_to_string(&claude_json).unwrap(), "[1,2]");

        std::fs::write(&claude_json, r#"{"mcpServers":[]}"#).unwrap();
        assert!(context.save_mcp_server(None, stdio_spec("srv3")).is_err());
        assert_eq!(
            std::fs::read_to_string(&claude_json).unwrap(),
            r#"{"mcpServers":[]}"#
        );
    }

    /// 共享 MCP 的保存与重命名投影到 .claude.json：旧名随重命名消失，用户自建条目与顶层字段保留。
    #[test]
    fn claude_mcp_save_and_rename_project_to_claude_json() {
        let (home, context) = test_context();
        std::fs::create_dir_all(&context.paths.codex_home).unwrap();
        std::fs::write(
            context.paths.codex_config(),
            "[mcp_servers.codex_only]\nurl = \"https://codex.example/mcp\"\n",
        )
        .unwrap();
        std::fs::write(
            home.path().join(".claude.json"),
            r#"{"other":"keep","mcpServers":{"hand_made":{"type":"stdio","command":"uvx"}}}"#,
        )
        .unwrap();

        context
            .save_mcp_server(
                None,
                McpServerSpec {
                    name: "shared".into(),
                    url: Some("https://mcp.example/mcp".into()),
                    http_headers: std::collections::BTreeMap::from([(
                        "X-Fixed".to_string(),
                        "v".to_string(),
                    )]),
                    ..Default::default()
                },
            )
            .unwrap();

        let doc = read_claude_mcp(&home);
        assert_eq!(doc["mcpServers"]["shared"]["type"], "http");
        assert_eq!(
            doc["mcpServers"]["shared"]["url"],
            "https://mcp.example/mcp"
        );
        assert_eq!(doc["mcpServers"]["shared"]["headers"]["X-Fixed"], "v");
        assert_eq!(doc["mcpServers"]["hand_made"]["command"], "uvx");
        assert_eq!(doc["other"], "keep");

        context
            .save_mcp_server(
                Some("shared"),
                McpServerSpec {
                    name: "renamed".into(),
                    url: Some("https://mcp.example/mcp".into()),
                    ..Default::default()
                },
            )
            .unwrap();

        let doc = read_claude_mcp(&home);
        assert!(doc["mcpServers"].get("shared").is_none());
        assert_eq!(
            doc["mcpServers"]["renamed"]["url"],
            "https://mcp.example/mcp"
        );
        assert!(doc["mcpServers"].get("hand_made").is_some());
        let config = std::fs::read_to_string(context.paths.codex_config()).unwrap();
        assert!(config.contains("renamed"), "{config}");
        assert!(!config.contains("shared"), "{config}");
    }

    #[test]
    fn switching_profiles_never_leaks_previous_keys() {
        let (home, context) = test_context();
        let a = context
            .database
            .insert_claude_profile(
                &draft("A", Some("https://a.example"), Some("tok-a"), Some("glm-a")),
                "1",
            )
            .unwrap();
        let b = context
            .database
            .insert_claude_profile(
                &draft("B", Some("https://b.example"), Some("tok-b"), None),
                "2",
            )
            .unwrap();
        context.claude_apply(&a.id).unwrap();
        context.claude_apply(&b.id).unwrap();

        let doc = read_settings(&home);
        assert_eq!(doc["env"]["ANTHROPIC_BASE_URL"], "https://b.example");
        assert_eq!(doc["env"]["ANTHROPIC_AUTH_TOKEN"], "tok-b");
        // A 配过 model、B 没配：切到 B 后上一家的 model 必须被撤下，不能残留
        assert!(doc["env"].get("ANTHROPIC_MODEL").is_none());
        assert_eq!(
            context.database.active_claude_profile().unwrap().as_deref(),
            Some(b.id.as_str())
        );
    }

    #[test]
    fn deleting_active_profile_retracts_managed_keys() {
        let (home, context) = test_context();
        let stored = context
            .database
            .insert_claude_profile(
                &draft("A", Some("https://a.example"), Some("tok-a"), None),
                "1",
            )
            .unwrap();
        context.claude_apply(&stored.id).unwrap();
        context.claude_delete(&stored.id).unwrap();

        let doc = read_settings(&home);
        assert!(doc["env"].get("ANTHROPIC_BASE_URL").is_none());
        assert!(doc["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
        assert_eq!(context.database.active_claude_profile().unwrap(), None);
        assert!(context.database.claude_profiles().unwrap().is_empty());
    }

    #[test]
    fn save_rewrites_live_when_profile_is_active() {
        let (_home, context) = test_context();
        let stored = context
            .database
            .insert_claude_profile(
                &draft("A", Some("https://a.example"), Some("tok-a"), None),
                "1",
            )
            .unwrap();
        context.claude_apply(&stored.id).unwrap();

        context
            .claude_save(
                Some(&stored.id),
                ClaudeProfileInput {
                    name: "A2".into(),
                    base_url: Some("https://b.example".into()),
                    auth_token: None,
                    model: None,
                    ..Default::default()
                },
            )
            .unwrap();

        let doc: Value = serde_json::from_str(
            &std::fs::read_to_string(_home.path().join(".claude/settings.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(doc["env"]["ANTHROPIC_BASE_URL"], "https://b.example");
        // 编辑语义 = 三个托管键整体替换：表单里清空 token 保存即从 live 撤下
        assert!(doc["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
    }

    #[test]
    fn corrupt_settings_json_is_rejected_not_overwritten() {
        let (home, context) = test_context();
        let settings = home.path().join(".claude/settings.json");
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        std::fs::write(&settings, "not json {").unwrap();
        let stored = context
            .database
            .insert_claude_profile(&draft("A", Some("https://a.example"), None, None), "1")
            .unwrap();

        assert!(context.claude_apply(&stored.id).is_err());
        assert_eq!(std::fs::read_to_string(&settings).unwrap(), "not json {");
    }

    #[test]
    fn extra_env_merges_into_live_and_retracts_on_switch() {
        let (home, context) = test_context();
        let a = context
            .database
            .insert_claude_profile(
                &ClaudeProfileInput {
                    extra_env: Some(
                        r#"{"API_TIMEOUT_MS":"3000","ANTHROPIC_DEFAULT_SONNET_MODEL":"glm-5.3"}"#
                            .to_string(),
                    ),
                    ..draft("A", Some("https://a.example"), Some("tok-a"), None)
                },
                "1",
            )
            .unwrap();
        let b = context
            .database
            .insert_claude_profile(
                &ClaudeProfileInput {
                    extra_env: Some(r#"{"FOO":"bar"}"#.to_string()),
                    ..draft("B", Some("https://b.example"), Some("tok-b"), None)
                },
                "2",
            )
            .unwrap();
        context.claude_apply(&a.id).unwrap();
        let doc = read_settings(&home);
        assert_eq!(doc["env"]["API_TIMEOUT_MS"], "3000");
        assert_eq!(doc["env"]["ANTHROPIC_DEFAULT_SONNET_MODEL"], "glm-5.3");

        context.claude_apply(&b.id).unwrap();
        let doc = read_settings(&home);
        // 上一家的附加键随切换一并撤下，只留本家的
        assert!(doc["env"].get("API_TIMEOUT_MS").is_none());
        assert!(doc["env"].get("ANTHROPIC_DEFAULT_SONNET_MODEL").is_none());
        assert_eq!(doc["env"]["FOO"], "bar");
    }

    #[test]
    fn duplicate_copies_row_and_inserts_after_source() {
        let (_home, context) = test_context();
        let a = context
            .database
            .insert_claude_profile(
                &draft("A", Some("https://a.example"), Some("tok"), None),
                "1",
            )
            .unwrap();
        let b = context
            .database
            .insert_claude_profile(&draft("B", Some("https://b.example"), None, None), "2")
            .unwrap();

        let copy = context.claude_duplicate(&a.id).unwrap();
        assert_eq!(copy.name, "A copy");
        // 列值随源（地址/凭证/图标），激活位不受影响
        assert_eq!(copy.base_url.as_deref(), Some("https://a.example"));
        assert_eq!(copy.auth_token.as_deref(), Some("tok"));
        assert_eq!(copy.icon, a.icon);
        assert_eq!(context.database.active_claude_profile().unwrap(), None);
        // 副本插到源卡片后面：A → A copy → B
        let order: Vec<String> = context
            .database
            .claude_profiles()
            .unwrap()
            .into_iter()
            .map(|profile| profile.id)
            .collect();
        assert_eq!(order, vec![a.id.clone(), copy.id.clone(), b.id.clone()]);

        // 重排持久化：把 B 挪到最前后按新序读出
        context
            .claude_reorder(&[b.id.clone(), a.id.clone(), copy.id.clone()])
            .unwrap();
        let order: Vec<String> = context
            .database
            .claude_profiles()
            .unwrap()
            .into_iter()
            .map(|profile| profile.id)
            .collect();
        assert_eq!(order, vec![b.id, a.id, copy.id]);
    }

    #[test]
    fn set_icon_validates_and_round_trips() {
        let (_home, context) = test_context();
        let stored = context
            .database
            .insert_claude_profile(&draft("A", Some("https://a.example"), None, None), "1")
            .unwrap();
        context
            .claude_set_icon(&stored.id, Some("zhipu".into()))
            .unwrap();
        assert_eq!(
            context
                .database
                .claude_profile(&stored.id)
                .unwrap()
                .icon
                .as_deref(),
            Some("zhipu")
        );
        // 非法图标 id（白名单外/超长）被 validated_icon 拒绝
        assert!(context
            .claude_set_icon(&stored.id, Some("NOT VALID!".into()))
            .is_err());
    }

    #[test]
    fn save_validates_extra_env_shape() {
        let (_home, context) = test_context();
        let bad = |value: &str| {
            context
                .claude_save(
                    None,
                    ClaudeProfileInput {
                        name: "A".into(),
                        extra_env: Some(value.into()),
                        ..Default::default()
                    },
                )
                .is_err()
        };
        assert!(bad("[1,2]"));
        assert!(bad(r#"{"K":1}"#));

        // 空对象合法但归一为不落列
        let stored = context
            .claude_save(
                None,
                ClaudeProfileInput {
                    name: "A".into(),
                    extra_env: Some("{}".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(stored.extra_env, None);
    }
}
