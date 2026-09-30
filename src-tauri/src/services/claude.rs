//! Claude Code 供应商：独立小引擎，把 base_url / token / model 注入 ~/.claude/settings.json 的 env。
//!
//! 供应商 env 与 Codex 的 config.toml 管线并行：不把 Claude 供应商字段塞进 Codex TOML，
//! 只复用 fsutil 的备份与原子写原语。MCP 是应用级共享配置，另投影到 Claude Code 的
//! 用户范围 ~/.claude.json。settings.json 的写回分两条路：非平凡快照（捕获/全文编辑过的）
//! 整文件替换；平凡快照与存量行走 merge——只整体替换托管 env 键（MANAGED_ENV_KEYS，
//! token 按 kind 写 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN），其余顶层键与 env 键原样保留。

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
/// token 在 live 里有两个形态键（AUTH_TOKEN 与 API_KEY），都属于托管、切换时一并撤下；
/// 写回哪个由 kind 决定（anthropic 落 API_KEY、其余落 AUTH_TOKEN），用户手写的另一形态不残留。
const MANAGED_ENV_KEYS: [&str; 4] = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
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
        admin_url: profile.admin_url.clone(),
        kind: profile.kind.clone(),
        show_balance: profile.show_balance,
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
        show_balance: profile.show_balance,
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

fn parse_settings_document(raw: &str) -> AppResult<Value> {
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
    Ok(document)
}

/// 账号模式仅使用 Claude Code 自己管理的登录；不触碰凭证文件。
fn clear_account_auth_overrides(document: &mut Value) {
    if let Some(env) = document.get_mut("env").and_then(Value::as_object_mut) {
        for key in [
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_API_KEY",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "CLAUDE_CODE_USE_BEDROCK",
            "CLAUDE_CODE_USE_VERTEX",
            "CLAUDE_CODE_USE_FOUNDRY",
            "ANTHROPIC_PROFILE",
            "ANTHROPIC_FEDERATION_RULE_ID",
            "ANTHROPIC_ORGANIZATION_ID",
        ] {
            env.remove(key);
        }
    }
    if let Some(object) = document.as_object_mut() {
        object.remove("apiKeyHelper");
    }
}

fn read_raw_settings(raw: &str, input: &mut ClaudeProfileInput) -> AppResult<()> {
    let document = parse_settings_document(raw)?;
    let env = document.get("env").and_then(Value::as_object);
    let field = |key: &str| {
        env.and_then(|env| env.get(key))
            .and_then(Value::as_str)
            .map(str::to_owned)
    };
    input.base_url = field("ANTHROPIC_BASE_URL");
    input.auth_token = field("ANTHROPIC_AUTH_TOKEN").or_else(|| field("ANTHROPIC_API_KEY"));
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

/// 平凡快照判定：顶层除 env 外没有任何其他键，且 env 的键全在托管集合内。
/// 新建供应商的 raw_settings 默认 "{}"（claude-account 保存时也强制 "{}"），
/// 属于从未捕获过真实文件的全新配置——整文件替换会静默清空用户 settings.json
/// 里的 permissions/hooks/statusLine 等现场，必须落入 merge 路径保住它们。
fn is_trivial_settings_snapshot(raw: &str) -> bool {
    let Ok(Value::Object(object)) = serde_json::from_str(raw) else {
        return false;
    };
    if !object.keys().all(|key| key == "env") {
        return false;
    }
    object.get("env").is_none_or(|env| {
        env.as_object().is_some_and(|env| {
            env.keys()
                .all(|key| MANAGED_ENV_KEYS.contains(&key.as_str()))
        })
    })
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

fn claude_mcp_entry(
    record: &crate::database::McpServerRecord,
    fallback: Option<&Value>,
) -> AppResult<Value> {
    let common = mcp_fragment_to_claude_entry(&record.name, &record.toml)?;
    let mut entry: Value = match &record.claude_json {
        Some(raw) => {
            serde_json::from_str(raw).map_err(|error| app_err!("Claude MCP JSON 无效: {error}"))?
        }
        None => match fallback {
            Some(entry) => entry.clone(),
            None => return Ok(common),
        },
    };
    let object = entry
        .as_object_mut()
        .ok_or_else(|| app_err!("Claude MCP 条目必须是对象"))?;
    let native_type = object.get("type").cloned();
    for key in ["type", "command", "url", "args", "env", "headers"] {
        object.remove(key);
    }
    object.extend(common.as_object().expect("转换结果为对象").clone());
    if object.contains_key("url")
        && native_type
            .as_ref()
            .and_then(Value::as_str)
            .is_some_and(|kind| kind != "stdio")
    {
        object.insert("type".into(), native_type.unwrap());
    }
    Ok(entry)
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
pub(super) fn claude_entry_to_spec(name: &str, value: &Value) -> AppResult<McpServerSpec> {
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

pub(super) fn read_claude_mcp_document(paths: &crate::paths::AppPaths) -> AppResult<Value> {
    let path = paths.claude_mcp_config();
    let document = match std::fs::read_to_string(&path) {
        Ok(text) if text.trim().is_empty() => Ok(Value::Object(Map::new())),
        Ok(text) => serde_json::from_str(&text)
            .map_err(|error| app_err!(".claude.json 不是有效 JSON，拒绝写入: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Value::Object(Map::new())),
        Err(error) => Err(app_err!("无法读取 {}: {error}", path.display())),
    }?;
    if !document.is_object() {
        return Err(app_err!(".claude.json 顶层不是对象，拒绝读写"));
    }
    if document
        .get("mcpServers")
        .is_some_and(|servers| !servers.is_object())
    {
        return Err(app_err!(".claude.json 的 mcpServers 不是对象，拒绝读写"));
    }
    Ok(document)
}

impl AppContext {
    fn claude_settings_path(&self) -> PathBuf {
        self.paths.claude_home.join("settings.json")
    }

    pub(super) fn read_claude_mcp_document(&self) -> AppResult<Value> {
        read_claude_mcp_document(&self.paths)
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
        previous: &[crate::database::McpServerRecord],
        current: &[crate::database::McpServerRecord],
    ) -> AppResult<()> {
        if previous.is_empty() && current.is_empty() {
            return Ok(());
        }
        let mut document = self.read_claude_mcp_document()?;
        let previous: std::collections::BTreeMap<_, _> = previous
            .iter()
            .filter(|record| {
                record.claude_installed
                    && record.claude_enabled
                    && !codex_config::is_managed_mcp_name(&record.name)
            })
            .filter_map(|record| {
                claude_mcp_entry(record, None)
                    .ok()
                    .map(|entry| (record.name.clone(), entry))
            })
            .collect();
        let current: std::collections::BTreeMap<_, _> = current
            .iter()
            .filter(|record| {
                record.claude_installed
                    && record.claude_enabled
                    && !codex_config::is_managed_mcp_name(&record.name)
            })
            .map(|record| {
                // 旧库没有原生快照时，保留现场的 Claude 专属字段；共享字段仍以镜像为准。
                let entry = claude_mcp_entry(
                    record,
                    document
                        .get("mcpServers")
                        .and_then(|servers| servers.get(&record.name)),
                )?;
                Ok((record.name.clone(), entry))
            })
            .collect::<AppResult<_>>()?;
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
            return self.sync_claude_mcp_projection(&[], &records);
        }
        if let Ok(document) = codex_config::parse_document(&self.read_live_config()?) {
            let live = codex_config::mcp_server_fragments_from_document(&document);
            if !live.is_empty() {
                return self.replace_mcp_mirror(&live);
            }
        }
        let document = self.read_claude_mcp_document()?;
        for (name, toml) in self.claude_mcp_fragments_from_live()? {
            self.database.save_mcp_server_record(
                None,
                &crate::database::McpServerRecord {
                    claude_json: document
                        .get("mcpServers")
                        .and_then(|servers| servers.get(&name))
                        .map(Value::to_string),
                    name,
                    toml,
                    codex_enabled: false,
                    claude_enabled: true,
                    codex_installed: true,
                    claude_installed: true,
                },
                &now_ms().to_string(),
            )?;
        }
        Ok(())
    }

    pub fn claude_mcp_servers(&self) -> AppResult<Vec<McpServerSpec>> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
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
            if !record.claude_installed || record.claude_enabled {
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
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        if let Some(record) = self.database.mcp_server_record(name)? {
            if record.claude_installed && !record.claude_enabled {
                let entry = claude_mcp_entry(&record, None)?;
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
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
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
        self.save_mcp_server_unlocked(
            original_name,
            spec,
            None,
            SkillTool::Claude,
            Some(entry.to_string()),
        )
    }

    pub fn delete_claude_mcp_server(&self, name: &str) -> AppResult<()> {
        self.delete_mcp_server_for_tool(name, SkillTool::Claude)
    }

    pub fn claude_list(&self) -> AppResult<Vec<ClaudeProfileSummary>> {
        // 进页/刷新时机对齐 Codex get_state：外部改过 live 就先同步回激活快照
        let _ = self.sync_active_claude_settings();
        Ok(self
            .database
            .claude_profiles()?
            .iter()
            .map(summary)
            .collect())
    }

    pub fn claude_common_settings(&self) -> AppResult<Option<String>> {
        self.database.claude_common_settings()
    }

    pub fn claude_save_common_settings(&self, text: Option<&str>) -> AppResult<()> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        if let Some(text) = text {
            parse_settings_document(text)?;
        }
        self.database.set_claude_common_settings(text)
    }

    /// 外部改过 ~/.claude/settings.json 时，把 live 全文与托管字段回写进激活快照
    /// （对齐 Codex 的 sync_active_profile_document）：无激活/读不了/解析失败/无差异
    /// 一律不写库，外部损坏绝不覆盖最后一次有效快照。
    fn sync_active_claude_settings(&self) -> AppResult<bool> {
        let Some(id) = self.database.active_claude_profile()? else {
            return Ok(false);
        };
        let Ok(stored) = self.database.claude_profile(&id) else {
            return Ok(false);
        };
        let Ok(raw) = std::fs::read_to_string(self.claude_settings_path()) else {
            return Ok(false);
        };
        let mut live = ClaudeProfileInput {
            // 供应商元数据不属于 live 文件，同步时保留
            name: stored.name.clone(),
            description: stored.description.clone(),
            kind: stored.kind.clone(),
            admin_url: stored.admin_url.clone(),
            icon: stored.icon.clone(),
            show_balance: stored.show_balance,
            fetched_models: stored
                .fetched_models
                .as_deref()
                .and_then(|text| serde_json::from_str(text).ok()),
            ..Default::default()
        };
        if read_raw_settings(&raw, &mut live).is_err() {
            return Ok(false);
        }
        let unchanged = live.base_url == stored.base_url
            && live.auth_token == stored.auth_token
            && live.model == stored.model
            && stored.raw_settings.as_deref() == Some(raw.as_str())
            && match (live.extra_env.as_deref(), stored.extra_env.as_deref()) {
                (Some(l), Some(s)) => {
                    serde_json::from_str::<Value>(l).ok() == serde_json::from_str::<Value>(s).ok()
                }
                (None, None) => true,
                _ => false,
            };
        if unchanged {
            return Ok(false);
        }
        live.raw_settings = Some(raw);
        self.database
            .update_claude_profile(&id, &live, &now_ms().to_string(), |_| Ok(()))?;
        Ok(true)
    }

    pub fn claude_get(&self, id: &str) -> AppResult<ClaudeProfileDetail> {
        // 打开激活供应商的编辑页：先把外部改动同步回数据库快照
        if self.database.active_claude_profile()?.as_deref() == Some(id) {
            let _ = self.sync_active_claude_settings();
        }
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
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        if input.kind.as_deref() == Some("claude-account") {
            let mut document =
                parse_settings_document(input.raw_settings.as_deref().unwrap_or("{}"))?;
            clear_account_auth_overrides(&mut document);
            input.raw_settings = Some(
                serde_json::to_string_pretty(&document)
                    .map_err(|error| app_err!("settings.json 序列化失败: {error}"))?,
            );
        }
        if let Some(raw) = input.raw_settings.clone() {
            read_raw_settings(&raw, &mut input)?;
        }
        // 名称/描述与 Codex 侧共用同一套校验（1-50 字符 / ≤200），claude_set_icon 复用 validated_icon 同理
        input.name = super::profiles::validated_name(&input.name)?;
        input.base_url = clean(input.base_url);
        input.auth_token = clean(input.auth_token);
        input.model = clean(input.model);
        input.description = super::profiles::validated_description(input.description.as_deref())?;
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
                let paths = if is_active {
                    vec![self.claude_settings_path()]
                } else {
                    Vec::new()
                };
                crate::fsutil::with_file_rollback(&paths, || {
                    self.database
                        .update_claude_profile(id, &input, &timestamp, |updated| {
                            if is_active {
                                self.write_claude_settings(Some(updated), &stale_extra_keys)?;
                            }
                            Ok(())
                        })
                })?
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

    pub fn claude_set_show_balance(&self, id: &str, enabled: bool) -> AppResult<()> {
        self.database
            .set_claude_profile_show_balance(id, enabled, &now_ms().to_string())
    }

    pub fn claude_reorder(&self, ids: &[String]) -> AppResult<()> {
        self.database
            .reorder_claude_profiles(ids, &now_ms().to_string())
    }

    /// 卡片上的测试连通：用已存凭证向真实调用路径 /v1/messages 判活，成功回传耗时（对齐 Codex 卡片测试按钮）。
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
        probe_claude_messages_reachable(&base_url, &auth_token).await
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
        let candidate = super::unique_copy_name(&base, |name| {
            profiles
                .iter()
                .any(|profile| profile.name.eq_ignore_ascii_case(name))
        });
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
                show_balance: stored.show_balance,
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
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        // 产品规则：使用中的配置不可删除（前端对激活卡片禁用删除按钮，与 Codex 同规则）。
        // 后端对齐拒绝：删除绝不能变成一次没有确认的 live 改写，托盘竞态只会得到明确报错。
        if self.database.active_claude_profile()?.as_deref() == Some(id) {
            return Err(app_err!(
                "无法删除使用中的 Claude 供应商配置，请先切换到其他配置"
            ));
        }
        self.database.delete_claude_profile(id)?;
        tauri_plugin_log::log::info!(
            "[provider.claude.delete] profile_id={id} outcome=success msg=\"已删除 Claude 供应商配置\""
        );
        Ok(())
    }

    pub fn claude_apply(&self, id: &str) -> AppResult<()> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
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
        // 顺序固定为先写 settings.json 再做 MCP 投影/首导入：首导入逐条落库不在文件
        // 回滚范围内，后置保证 settings 写失败时不留半套镜像；反之导入或落库失败时
        // 两个 live 文件整体回滚（已导入的镜像行残留无害：下次应用走 sync 投影收敛）。
        crate::fsutil::with_file_rollback(
            &[self.claude_settings_path(), self.paths.claude_mcp_config()],
            || {
                self.write_claude_settings(Some(&stored), &stale_extra_keys)?;
                self.ensure_claude_mcp_projection()?;
                self.database.set_active_claude_profile(Some(id))
            },
        )?;
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

    /// 非平凡全文快照直接恢复原文；平凡快照与旧配置走 merge 只合并托管 env 键。
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
            // 平凡快照（新建配置的 "{}"/纯托管键 env）不做整文件替换，落入下方
            // merge 路径保住用户现场；非平凡快照（捕获/全文编辑过的）保持整文件替换。
            if !is_trivial_settings_snapshot(raw) {
                if values.is_some_and(|profile| profile.kind.as_deref() == Some("claude-account")) {
                    let mut document = parse_settings_document(raw)?;
                    clear_account_auth_overrides(&mut document);
                    let bytes = serde_json::to_vec_pretty(&document)
                        .map_err(|error| app_err!("settings.json 序列化失败: {error}"))?;
                    return atomic_write(&path, &bytes);
                }
                return atomic_write(&path, raw.as_bytes());
            }
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
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Value::Object(Map::new()),
            Err(error) => return Err(app_err!("无法读取 {}: {error}", path.display())),
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
                // token 按 kind 落 API_KEY 或 AUTH_TOKEN（对齐前端 patchEnvFields）；
                // 另一形态已在上方随托管键撤下，用户手写的旧形态不残留。
                for (key, value) in [
                    ("ANTHROPIC_BASE_URL", profile.base_url.as_deref()),
                    (
                        if profile.kind.as_deref() == Some("anthropic") {
                            "ANTHROPIC_API_KEY"
                        } else {
                            "ANTHROPIC_AUTH_TOKEN"
                        },
                        profile.auth_token.as_deref(),
                    ),
                    ("ANTHROPIC_MODEL", profile.model.as_deref()),
                ] {
                    if let Some(text) = value.filter(|text| !text.trim().is_empty()) {
                        env.insert(key.to_string(), Value::String(text.to_string()));
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
        if values.is_some_and(|profile| profile.kind.as_deref() == Some("claude-account")) {
            clear_account_auth_overrides(&mut document);
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

/// Anthropic 兼容请求共用的 HTTP 客户端：复用 connections 的统一出口（显式系统代理、
/// 环回直连、按代理缓存的连接池）。该客户端默认 8 秒超时，Claude 侧的模型拉取与
/// 判活按请求覆盖为 FETCH_TIMEOUT_SECS，保持原超时语义。
fn anthropic_client() -> AppResult<reqwest::Client> {
    super::connections::http_client().map(|(client, _proxy)| client)
}

/// 拉取 Anthropic 兼容端点的模型列表：base_url 无版本段 → `{base}/v1/models`；
/// 带 `/v{N}` 版本段 → `{base}/models`。脱敏/截断/版本段判断复用 model_fetch 的原语。
///
/// 厂商兼容面（DeepSeek/Kimi 的 `{OpenAI根}/anthropic`）往往不实现 /models 路由：
/// 此时剥掉 /anthropic 后缀回同根 OpenAI 面拉真实列表（先 `/v1/models` 后 `/models`）——
/// 同一厂商同一把 Key，两个面的列表响应同为 data[].id 同构。连通性判活另由
/// probe_claude_messages_reachable 走真实调用路径负责，两者互不掺和。
pub async fn fetch_claude_models(base_url: &str, auth_token: &str) -> AppResult<Vec<String>> {
    let trimmed = base_url.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return Err(app_err!("API 端点为空"));
    }
    if auth_token.trim().is_empty() {
        return Err(app_err!("请先填写 API Token 再获取模型列表"));
    }
    let candidate_urls = if ends_with_version_segment(trimmed) {
        vec![format!("{trimmed}/models")]
    } else {
        let mut urls = vec![format!("{trimmed}/v1/models")];
        if let Some(root) = trimmed.strip_suffix("/anthropic") {
            if !root.is_empty() {
                urls.push(format!("{root}/v1/models"));
                urls.push(format!("{root}/models"));
            }
        }
        urls
    };

    let client = anthropic_client()?;
    for url in candidate_urls {
        let response = client
            .get(&url)
            .timeout(std::time::Duration::from_secs(FETCH_TIMEOUT_SECS))
            .header("x-api-key", auth_token)
            .header("anthropic-version", "2023-06-01")
            .bearer_auth(auth_token)
            .send()
            .await
            .map_err(|error| app_err!("请求失败: {error}"))?;
        let status = response.status();
        if matches!(status.as_u16(), 404 | 405) {
            continue;
        }
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
        return Ok(models);
    }
    // 全部候选都没有 /models 路由：模型列表留空，上层提示手动填模型。
    Ok(Vec::new())
}

/// Claude 侧连通性判活的真源：POST 最小对话请求（1 token）到真实调用路径 /v1/messages
/// （带 /v{N} 版本段的 base 挂在版本段下）。DeepSeek/Kimi 等厂商兼容面没有 /models，
/// 但对话路径必然存在；未知模型名会被服务端自动映射或以 4xx 拒绝，均证明端点可达。
/// 401/403 报凭证错误、404 报非 Anthropic 兼容面，其余任何 HTTP 响应都算连通，回传耗时毫秒。
pub async fn probe_claude_messages_reachable(trimmed: &str, auth_token: &str) -> AppResult<u64> {
    if trimmed.is_empty() {
        return Err(app_err!("API 端点为空"));
    }
    let url = if ends_with_version_segment(trimmed) {
        format!("{trimmed}/messages")
    } else {
        format!("{trimmed}/v1/messages")
    };
    let started_at = std::time::Instant::now();
    let response = anthropic_client()?
        .post(&url)
        .timeout(std::time::Duration::from_secs(FETCH_TIMEOUT_SECS))
        .header("x-api-key", auth_token)
        .header("anthropic-version", "2023-06-01")
        .bearer_auth(auth_token)
        .json(&serde_json::json!({
            "model": "claude",
            "max_tokens": 1,
            "messages": [{"role": "user", "content": "ping"}]
        }))
        .send()
        .await
        .map_err(|error| app_err!("请求失败: {error}"))?;
    let status = response.status();
    if matches!(status.as_u16(), 401 | 403 | 404) {
        let body = response.text().await.unwrap_or_default();
        return Err(app_err!(
            "HTTP {status}: {}",
            truncate_body(redact(&body, auth_token))
        ));
    }
    Ok(started_at.elapsed().as_millis() as u64)
}

#[cfg(test)]
mod tests {
    #[test]
    fn account_auth_overrides_are_removed_and_api_key_is_read_back() {
        let mut document = serde_json::json!({
            "apiKeyHelper": "fixture-helper", "hooks": {"Stop": []},
            "permissions": {"deny": ["WebFetch"]},
            "env": {"ANTHROPIC_BASE_URL": "https://fixture.test", "ANTHROPIC_API_KEY": "key",
                "ANTHROPIC_AUTH_TOKEN": "token", "CLAUDE_CODE_OAUTH_TOKEN": "override",
                "CLAUDE_CODE_USE_BEDROCK": "1", "ANTHROPIC_PROFILE": "fixture", "KEEP": "keep"}
        });
        super::clear_account_auth_overrides(&mut document);
        assert_eq!(
            document,
            serde_json::json!({"hooks": {"Stop": []},
            "permissions": {"deny": ["WebFetch"]}, "env": {"KEEP": "keep"}})
        );
        let mut input = crate::models::ClaudeProfileInput::default();
        super::read_raw_settings(r#"{"env":{"ANTHROPIC_API_KEY":"key"}}"#, &mut input).unwrap();
        assert_eq!(input.auth_token.as_deref(), Some("key"));
    }

    use super::*;
    use crate::services::plugins::test_context;

    #[test]
    fn settings_validation_preserves_unknown_template_fields() {
        let raw = r#"{"hooks":{"Stop":[]},"permissions":{"allow":["Read"]},"env":{"CUSTOM":"keep"},"unknown":{"nested":null}}"#;
        assert_eq!(
            parse_settings_document(raw).unwrap().to_string(),
            serde_json::from_str::<Value>(raw).unwrap().to_string()
        );
        for invalid in [
            "",
            "{",
            "null",
            "[]",
            r#"{"env":null}"#,
            r#"{"env":[]}"#,
            r#"{"env":{"CUSTOM":42}}"#,
        ] {
            assert!(parse_settings_document(invalid).is_err());
        }
    }

    #[test]
    fn native_mcp_json_survives_reads_toggles_edits_and_backup_restore() {
        let (home, context) = test_context();
        let raw = r#"{"type":"sse","url":"https://example.test/mcp","custom":{"keep":true}}"#;
        std::fs::create_dir_all(&context.paths.codex_home).unwrap();
        std::fs::write(
            context.paths.codex_config(),
            "[mcp_servers.native]\nurl=\"https://example.test/mcp\"\n",
        )
        .unwrap();
        let external = format!("{{\"mcpServers\":{{\"native\":{raw}}}}}");
        std::fs::write(context.paths.claude_mcp_config(), &external).unwrap();
        context.claude_mcp_servers().unwrap();
        assert_eq!(
            std::fs::read_to_string(context.paths.claude_mcp_config()).unwrap(),
            external
        );
        assert!(context.database.mcp_server_records().unwrap().is_empty());
        // 首次应用才初始化共享镜像，也必须保留已有 Claude 原生字段。
        context.ensure_claude_mcp_projection().unwrap();
        assert_eq!(
            read_claude_mcp(&home)["mcpServers"]["native"]["type"],
            "sse"
        );
        context
            .save_claude_mcp_server(Some("native"), "native", raw)
            .unwrap();
        context.claude_mcp_servers().unwrap();
        assert_eq!(
            read_claude_mcp(&home)["mcpServers"]["native"]["type"],
            "sse"
        );
        context
            .set_mcp_server_enabled("native", SkillTool::Claude, false)
            .unwrap();
        let disabled: Value =
            serde_json::from_str(&context.claude_mcp_server_json("native").unwrap().unwrap())
                .unwrap();
        assert_eq!(disabled["custom"]["keep"], true);
        context.save_mcp_server_with_fragment(Some("native"), McpServerSpec {
            name: "native".into(), url: Some("https://example.test/mcp".into()),
            startup_timeout_sec: Some(120), ..Default::default()
        }, Some("[mcp_servers.native]\nurl=\"https://example.test/mcp\"\nstartup_timeout_sec=120\ncodex_only=\"keep\"\n"), SkillTool::Codex).unwrap();
        context
            .set_mcp_server_enabled("native", SkillTool::Codex, false)
            .unwrap();
        context
            .save_claude_mcp_server(Some("native"), "native", raw)
            .unwrap();
        context
            .set_mcp_server_enabled("native", SkillTool::Codex, true)
            .unwrap();
        let codex_fragment = context.mcp_server_toml("native").unwrap().unwrap();
        assert!(codex_fragment.contains("codex_only"));
        assert_eq!(
            codex_config::spec_from_fragment("native", &codex_fragment)
                .unwrap()
                .startup_timeout_sec,
            Some(120)
        );
        context
            .set_mcp_server_enabled("native", SkillTool::Claude, true)
            .unwrap();
        context
            .save_mcp_server(
                Some("native"),
                McpServerSpec {
                    name: "native".into(),
                    url: Some("https://example.test/changed".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        let backup = context.export_database().unwrap();
        context.delete_mcp_server("native").unwrap();
        context.import_database(backup.to_str().unwrap()).unwrap();
        let entry = &read_claude_mcp(&home)["mcpServers"]["native"];
        assert_eq!(entry["type"], "sse");
        assert_eq!(entry["url"], "https://example.test/changed");
        assert_eq!(entry["custom"]["keep"], true);
        let external = r#"{"mcpServers":{"native":{"type":"sse","url":"https://example.test/external","extra":1}}}"#;
        std::fs::write(context.paths.claude_mcp_config(), external).unwrap();
        context.claude_mcp_servers().unwrap();
        context.claude_mcp_server_json("native").unwrap();
        assert_eq!(
            std::fs::read_to_string(context.paths.claude_mcp_config()).unwrap(),
            external
        );
    }

    #[test]
    fn mcp_rename_collision_is_read_only_and_success_preserves_other_engine_flag() {
        let (home, context) = test_context();
        for name in ["a", "b"] {
            context
                .save_claude_mcp_server(None, name, r#"{"command":"echo"}"#)
                .unwrap();
        }
        let codex = std::fs::read(context.paths.codex_config()).unwrap();
        let claude = std::fs::read(context.paths.claude_mcp_config()).unwrap();
        assert!(context
            .save_mcp_server(
                Some("a"),
                McpServerSpec {
                    name: "b".into(),
                    command: Some("echo".into()),
                    ..Default::default()
                }
            )
            .is_err());
        assert!(context.database.mcp_server_record("a").unwrap().is_some());
        assert_eq!(std::fs::read(context.paths.codex_config()).unwrap(), codex);
        assert_eq!(
            std::fs::read(context.paths.claude_mcp_config()).unwrap(),
            claude
        );
        context
            .set_mcp_server_enabled("b", SkillTool::Codex, false)
            .unwrap();
        let codex = std::fs::read(context.paths.codex_config()).unwrap();
        context
            .save_claude_mcp_server(
                Some("b"),
                "claude_renamed",
                r#"{"command":"echo","custom":1}"#,
            )
            .unwrap();
        let record = context
            .database
            .mcp_server_record("claude_renamed")
            .unwrap()
            .unwrap();
        assert!(!record.codex_enabled);
        assert!(record.claude_enabled);
        assert!(context.database.mcp_server_record("b").unwrap().is_none());
        assert_eq!(std::fs::read(context.paths.codex_config()).unwrap(), codex);
        assert_eq!(
            read_claude_mcp(&home)["mcpServers"]["claude_renamed"]["custom"],
            1
        );
        context
            .set_mcp_server_enabled("a", SkillTool::Claude, false)
            .unwrap();
        context
            .save_mcp_server(
                Some("a"),
                McpServerSpec {
                    name: "renamed".into(),
                    command: Some("echo".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        let record = context
            .database
            .mcp_server_record("renamed")
            .unwrap()
            .unwrap();
        assert!(record.codex_enabled);
        assert!(!record.claude_enabled);
        assert!(context.database.mcp_server_record("a").unwrap().is_none());
        assert!(read_claude_mcp(&home)["mcpServers"]
            .get("renamed")
            .is_none());
        // 数据库写入在两个 live 文件之后失败，也必须撤回改名造成的文件变更。
        let codex = std::fs::read(context.paths.codex_config()).unwrap();
        let claude = std::fs::read(context.paths.claude_mcp_config()).unwrap();
        rusqlite::Connection::open(&context.paths.database).unwrap().execute_batch(
            "CREATE TRIGGER fail_mcp_save BEFORE INSERT ON mcp_servers WHEN NEW.name='blocked' BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END;"
        ).unwrap();
        assert!(context
            .save_mcp_server(
                Some("claude_renamed"),
                McpServerSpec {
                    name: "blocked".into(),
                    command: Some("echo".into()),
                    ..Default::default()
                }
            )
            .is_err());
        assert!(context
            .database
            .mcp_server_record("claude_renamed")
            .unwrap()
            .is_some());
        assert!(context
            .database
            .mcp_server_record("blocked")
            .unwrap()
            .is_none());
        assert_eq!(std::fs::read(context.paths.codex_config()).unwrap(), codex);
        assert_eq!(
            std::fs::read(context.paths.claude_mcp_config()).unwrap(),
            claude
        );
    }

    #[test]
    fn toggling_external_claude_mcp_preserves_unrelated_mirror_and_native_json() {
        let (_home, context) = test_context();
        context
            .save_claude_mcp_server(None, "a", r#"{"command":"echo"}"#)
            .unwrap();
        context
            .set_mcp_server_enabled("a", SkillTool::Claude, false)
            .unwrap();
        std::fs::write(context.paths.claude_mcp_config(), r#"{"mcpServers":{"external":{"type":"sse","url":"https://example.test/mcp","custom":1}}}"#).unwrap();
        let codex = std::fs::read(context.paths.codex_config()).unwrap();
        context
            .set_mcp_server_enabled("external", SkillTool::Claude, false)
            .unwrap();
        assert!(
            context
                .database
                .mcp_server_record("a")
                .unwrap()
                .unwrap()
                .codex_enabled
        );
        assert_eq!(std::fs::read(context.paths.codex_config()).unwrap(), codex);
        context
            .set_mcp_server_enabled("external", SkillTool::Claude, true)
            .unwrap();
        let entry: Value =
            serde_json::from_str(&context.claude_mcp_server_json("external").unwrap().unwrap())
                .unwrap();
        assert_eq!(entry["type"], "sse");
        assert_eq!(entry["custom"], 1);
        assert!(
            !context
                .database
                .mcp_server_record("external")
                .unwrap()
                .unwrap()
                .codex_enabled
        );
    }

    #[test]
    fn failed_active_profile_save_delete_and_apply_preserve_database_and_live() {
        let (_home, context) = test_context();
        let a = context
            .claude_save(None, draft("A", Some("https://a.example.test"), None, None))
            .unwrap();
        let b = context
            .claude_save(None, draft("B", Some("https://b.example.test"), None, None))
            .unwrap();
        context.claude_apply(&a.id).unwrap();
        std::fs::write(context.claude_settings_path(), "invalid {").unwrap();
        assert!(context
            .claude_save(
                Some(&a.id),
                draft("changed", Some("https://changed.example.test"), None, None)
            )
            .is_err());
        assert_eq!(context.database.claude_profile(&a.id).unwrap().name, "A");
        assert!(context.claude_delete(&a.id).is_err());
        assert!(context.database.claude_profile(&a.id).is_ok());
        assert!(context.claude_apply(&b.id).is_err());
        assert_eq!(
            context.database.active_claude_profile().unwrap().as_deref(),
            Some(a.id.as_str())
        );
        assert_eq!(
            std::fs::read_to_string(context.claude_settings_path()).unwrap(),
            "invalid {"
        );
    }

    #[test]
    fn import_and_restore_reconcile_claude_mcp_including_empty_backups_and_rollback() {
        for import in [true, false] {
            let (home, context) = test_context();
            let a = context
                .claude_save(None, draft("A", Some("https://a.example.test"), None, None))
                .unwrap();
            let b = context
                .claude_save(None, draft("B", Some("https://b.example.test"), None, None))
                .unwrap();
            context.claude_apply(&a.id).unwrap();
            let backup = context.export_database().unwrap(); // 有 MCP 表，但集合为空。
            context.claude_apply(&b.id).unwrap();
            context
                .save_claude_mcp_server(None, "later", r#"{"command":"echo"}"#)
                .unwrap();
            let restore = || {
                if import {
                    context.import_database(backup.to_str().unwrap())
                } else {
                    context.restore_database(backup.file_name().unwrap().to_str().unwrap())
                }
            };
            std::fs::write(context.paths.claude_mcp_config(), "invalid {").unwrap();
            let settings = std::fs::read(context.claude_settings_path()).unwrap();
            let codex = std::fs::read(context.paths.codex_config()).unwrap();
            assert!(restore().is_err());
            assert_eq!(
                context.database.active_claude_profile().unwrap().as_deref(),
                Some(b.id.as_str())
            );
            assert!(context
                .database
                .mcp_server_record("later")
                .unwrap()
                .is_some());
            assert_eq!(
                std::fs::read(context.claude_settings_path()).unwrap(),
                settings
            );
            assert_eq!(std::fs::read(context.paths.codex_config()).unwrap(), codex);
            std::fs::write(context.paths.claude_mcp_config(), r#"{"mcpServers":{"later":{"type":"stdio","command":"echo"},"unmanaged":{"command":"keep"}},"projects":{"keep":true}}"#).unwrap();
            restore().unwrap();
            assert_eq!(
                context.database.active_claude_profile().unwrap().as_deref(),
                Some(a.id.as_str())
            );
            assert_eq!(
                read_settings(&home)["env"]["ANTHROPIC_BASE_URL"],
                "https://a.example.test"
            );
            assert!(context.database.mcp_server_records().unwrap().is_empty());
            let live = read_claude_mcp(&home);
            assert!(live["mcpServers"].get("later").is_none());
            assert_eq!(live["mcpServers"]["unmanaged"]["command"], "keep");
            assert_eq!(live["projects"]["keep"], true);
            assert!(codex_config::mcp_server_fragments_from_document(
                &codex_config::parse_document(&context.read_live_config().unwrap()).unwrap()
            )
            .is_empty());
            // 无 MCP 表的旧备份和有表但空集合不同：前者不能清空用户现场。
            rusqlite::Connection::open(&backup)
                .unwrap()
                .execute("DROP TABLE mcp_servers", [])
                .unwrap();
            let codex = "[mcp_servers.external]\ncommand=\"keep\"\n";
            let claude = r#"{"mcpServers":{"external":{"command":"keep"}}}"#;
            std::fs::write(context.paths.codex_config(), codex).unwrap();
            std::fs::write(context.paths.claude_mcp_config(), claude).unwrap();
            restore().unwrap();
            assert_eq!(context.read_live_config().unwrap(), codex);
            assert_eq!(
                std::fs::read_to_string(context.paths.claude_mcp_config()).unwrap(),
                claude
            );
        }
    }

    /// 本地一次性 HTTP 服务：按 (方法, 路径) 返回预置 (状态码, 响应体)，供模型拉取回退测试用。
    fn spawn_local_http(
        responder: impl Fn(&str, &str) -> (u16, String) + Send + 'static,
    ) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut buffer = [0u8; 4096];
                let read = std::io::Read::read(&mut stream, &mut buffer).unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..read]).to_string();
                let mut parts = request.split_whitespace();
                let method = parts.next().unwrap_or("");
                let path = parts.next().unwrap_or("");
                let (status, body) = responder(method, path);
                let response = format!(
                    "HTTP/1.1 {status} Status\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                use std::io::Write as _;
                let _ = stream.write_all(response.as_bytes());
            }
        });
        format!("http://{addr}")
    }

    /// 连通判活的真源是真实调用路径 /v1/messages：厂商兼容面可以没有 /models，但对话路径必然存在。
    #[tokio::test]
    async fn probe_reachable_when_messages_route_exists() {
        let base = spawn_local_http(|method, path| match (method, path) {
            ("POST", "/v1/messages") => (200, "{}".into()),
            _ => (500, "{}".into()),
        });
        probe_claude_messages_reachable(&base, "token-1")
            .await
            .unwrap();
    }

    /// 服务端对请求体本身回 4xx（如未知模型）也证明路径与鉴权在位，仍是连通。
    #[tokio::test]
    async fn probe_treats_body_rejection_as_reachable() {
        let base = spawn_local_http(|method, path| match (method, path) {
            ("POST", "/v1/messages") => (400, r#"{"error":"bad request"}"#.into()),
            _ => (500, "{}".into()),
        });
        probe_claude_messages_reachable(&base, "token-1")
            .await
            .unwrap();
    }

    /// 判活撞上 401 保留凭证错误：Key 无效不能谎报连通。
    #[tokio::test]
    async fn probe_reports_auth_failure() {
        let base = spawn_local_http(|method, path| match (method, path) {
            ("POST", "/v1/messages") => (401, r#"{"error":"unauthorized"}"#.into()),
            _ => (500, "{}".into()),
        });
        let error = probe_claude_messages_reachable(&base, "token-1")
            .await
            .unwrap_err();
        assert!(error.0.contains("401"), "{error:?}");
    }

    /// 判活若 /v1/messages 也是 404，说明该地址不是 Anthropic 兼容面，保留原始 404 报错。
    #[tokio::test]
    async fn probe_reports_missing_surface() {
        let base = spawn_local_http(|_method, _path| (404, "{}".into()));
        let error = probe_claude_messages_reachable(&base, "token-1")
            .await
            .unwrap_err();
        assert!(error.0.contains("404"), "{error:?}");
    }

    /// 带 /v{N} 版本段的 base：判活直接挂在版本段下。
    #[tokio::test]
    async fn probe_under_version_segment_path() {
        let base = spawn_local_http(|method, path| match (method, path) {
            ("POST", "/v1/messages") => (200, "{}".into()),
            _ => (500, "{}".into()),
        });
        probe_claude_messages_reachable(&format!("{base}/v1"), "token-1")
            .await
            .unwrap();
    }

    /// 获取模型只管 /models：厂商兼容面没有该路由时返回空列表，且不再顺带发判活请求
    ///（连通性与模型列表解耦，真源分别是 /v1/messages 与 /models）。
    #[tokio::test]
    async fn fetch_models_404_returns_empty_without_probe() {
        let posted = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let flag = posted.clone();
        let base = spawn_local_http(move |method, path| match (method, path) {
            ("GET", "/v1/models") => (404, "{}".into()),
            _ => {
                flag.store(true, std::sync::atomic::Ordering::SeqCst);
                (500, "{}".into())
            }
        });
        let models = fetch_claude_models(&base, "token-1").await.unwrap();
        assert!(models.is_empty());
        assert!(
            !posted.load(std::sync::atomic::Ordering::SeqCst),
            "获取模型不应顺带发判活请求"
        );
    }

    /// `{root}/anthropic` 形状的厂商兼容面没有 /models 时，剥后缀回同根 OpenAI 面拉真实列表
    ///（同厂商同一把 Key，先试 `/v1/models` 再试 `/models`）。
    #[tokio::test]
    async fn fetch_models_falls_back_to_sibling_openai_surface() {
        let base = spawn_local_http(|method, path| match (method, path) {
            ("GET", "/anthropic/v1/models") => (404, "{}".into()),
            ("GET", "/v1/models") => (200, r#"{"data":[{"id":"model-a"}]}"#.into()),
            _ => (500, "{}".into()),
        });
        let models = fetch_claude_models(&format!("{base}/anthropic"), "token-1")
            .await
            .unwrap();
        assert_eq!(models, vec!["model-a"]);
    }

    /// 同根 OpenAI 面先 `/v1/models` 后 `/models`（DeepSeek 用后者也能接住）。
    #[tokio::test]
    async fn fetch_models_sibling_falls_back_to_root_models() {
        let base = spawn_local_http(|method, path| match (method, path) {
            ("GET", "/anthropic/v1/models") => (404, "{}".into()),
            ("GET", "/v1/models") => (404, "{}".into()),
            ("GET", "/models") => (200, r#"{"data":[{"id":"model-a"}]}"#.into()),
            _ => (500, "{}".into()),
        });
        let models = fetch_claude_models(&format!("{base}/anthropic"), "token-1")
            .await
            .unwrap();
        assert_eq!(models, vec!["model-a"]);
    }

    /// 同根回退撞上 401 说明 Key 无效，报错而不是吞成空列表。
    #[tokio::test]
    async fn fetch_models_sibling_auth_failure_reports_error() {
        let base = spawn_local_http(|method, path| match (method, path) {
            ("GET", "/anthropic/v1/models") => (404, "{}".into()),
            ("GET", "/v1/models") => (401, r#"{"error":"unauthorized"}"#.into()),
            _ => (500, "{}".into()),
        });
        let error = fetch_claude_models(&format!("{base}/anthropic"), "token-1")
            .await
            .unwrap_err();
        assert!(error.0.contains("401"), "{error:?}");
    }

    /// /models 存在的端点（真 Anthropic、完整中转、智谱）维持原行为：解析 data[].id 并排序。
    #[tokio::test]
    async fn models_list_still_parsed_when_present() {
        let base = spawn_local_http(|method, path| match (method, path) {
            ("GET", "/v1/models") => (
                200,
                r#"{"data":[{"id":"model-b"},{"id":"model-a"}]}"#.into(),
            ),
            _ => (500, "{}".into()),
        });
        let models = fetch_claude_models(&base, "token-1").await.unwrap();
        assert_eq!(models, vec!["model-a", "model-b"]);
    }

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

    /// 外部改过 ~/.claude/settings.json：进列表/开编辑页把 live 回写进激活快照（对齐 Codex 同步语义）；
    /// 无差异不写库（updated_at 稳定），live 损坏不覆盖最后一次有效快照。
    #[test]
    fn external_live_edit_syncs_back_to_active_snapshot() {
        let (home, context) = test_context();
        let settings = home.path().join(".claude/settings.json");
        let stored = context
            .database
            .insert_claude_profile(
                &ClaudeProfileInput {
                    description: Some("保留元数据".into()),
                    ..draft("A", Some("https://a.example"), Some("tok-a"), Some("glm-a"))
                },
                "1",
            )
            .unwrap();
        context.claude_apply(&stored.id).unwrap();
        let external = r#"{"model":"opus","permissions":{"allow":["Read"]},"env":{"ANTHROPIC_BASE_URL":"https://changed.example","ANTHROPIC_AUTH_TOKEN":"tok-a","ANTHROPIC_MODEL":"glm-a","CUSTOM":"keep"}}"#;
        std::fs::write(&settings, external).unwrap();

        context.claude_list().unwrap();
        let synced = context.claude_get(&stored.id).unwrap();
        assert_eq!(synced.base_url.as_deref(), Some("https://changed.example"));
        assert_eq!(synced.model.as_deref(), Some("glm-a"));
        assert_eq!(synced.extra_env.as_deref(), Some(r#"{"CUSTOM":"keep"}"#));
        assert_eq!(synced.raw_settings.as_deref(), Some(external));
        assert_eq!(synced.description.as_deref(), Some("保留元数据"));
        assert_eq!(
            context.database.active_claude_profile().unwrap().as_deref(),
            Some(stored.id.as_str())
        );

        // 无差异：再次读取不再写库
        let synced_at = synced.updated_at.clone();
        context.claude_list().unwrap();
        assert_eq!(
            context.claude_get(&stored.id).unwrap().updated_at,
            synced_at
        );

        // live 损坏：同步静默跳过，快照保持最后一次有效内容
        std::fs::write(&settings, "invalid {").unwrap();
        context.claude_list().unwrap();
        assert_eq!(
            context
                .claude_get(&stored.id)
                .unwrap()
                .raw_settings
                .as_deref(),
            Some(external)
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
        assert!(doc["mcpServers"].get("remote").is_some());
        assert!(doc["mcpServers"].get("unmanaged").is_some());
    }

    /// .claude.json 损坏 / 顶层或 mcpServers 不是对象：投影一律拒绝写入，原文件字节不动。
    /// 保存失败时 Codex 文件与数据库镜像也保持原样。
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
        assert!(context.database.mcp_server_records().unwrap().is_empty());
        assert_eq!(
            std::fs::read_to_string(context.paths.codex_config()).unwrap(),
            ""
        );
        // 整段采纳失败同样不能留下已提交的镜像，修复现场后可以重试同一名称。
        let fragment = "[mcp_servers.retry]\ncommand=\"echo\"\n".to_string();
        assert!(context
            .replace_mcp_mirror(&[("retry".into(), fragment.clone())])
            .is_err());
        assert!(context.database.mcp_server_records().unwrap().is_empty());
        std::fs::write(&claude_json, "{}").unwrap();
        context
            .replace_mcp_mirror(&[("retry".into(), fragment)])
            .unwrap();
        assert_eq!(
            read_claude_mcp(&home)["mcpServers"]["retry"]["command"],
            "echo"
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
    fn deleting_active_profile_is_rejected() {
        let (home, context) = test_context();
        let stored = context
            .database
            .insert_claude_profile(
                &draft("A", Some("https://a.example"), Some("tok-a"), None),
                "1",
            )
            .unwrap();
        context.claude_apply(&stored.id).unwrap();
        // 使用中的配置不可删除（前端删除按钮对激活卡片禁用）：拒绝后 live 与库都保持原样
        assert!(context.claude_delete(&stored.id).is_err());
        let doc = read_settings(&home);
        assert_eq!(doc["env"]["ANTHROPIC_BASE_URL"], "https://a.example");
        assert_eq!(
            context.database.active_claude_profile().unwrap().as_deref(),
            Some(stored.id.as_str())
        );
        assert_eq!(context.database.claude_profiles().unwrap().len(), 1);
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
        // 编辑语义 = 托管键整体替换：表单里清空 token 保存即从 live 撤下
        assert!(doc["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
    }

    /// 平凡快照（新建配置的 "{}"/纯托管键 env）不得整文件覆写用户现场：应用落 merge，
    /// permissions/statusLine 与非托管 env 键原样保留；非 anthropic kind 的 token 落
    /// AUTH_TOKEN，live 里另一形态的手写 API_KEY 一并撤下。
    #[test]
    fn trivial_snapshot_merges_env_and_preserves_user_settings() {
        let (home, context) = test_context();
        let settings = home.path().join(".claude/settings.json");
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        std::fs::write(
            &settings,
            r#"{"permissions":{"deny":["WebFetch"]},"statusLine":{"command":"fixture"},
                "env":{"ANTHROPIC_API_KEY":"stale","KEEP":"1"}}"#,
        )
        .unwrap();
        let created = context
            .claude_save(
                None,
                ClaudeProfileInput {
                    name: "新建".into(),
                    raw_settings: Some(
                        r#"{"env":{"ANTHROPIC_BASE_URL":"https://relay.example","ANTHROPIC_AUTH_TOKEN":"tok"}}"#
                            .into(),
                    ),
                    ..Default::default()
                },
            )
            .unwrap();
        context.claude_apply(&created.id).unwrap();

        let doc = read_settings(&home);
        assert_eq!(doc["permissions"]["deny"][0], "WebFetch");
        assert_eq!(doc["statusLine"]["command"], "fixture");
        assert_eq!(doc["env"]["KEEP"], "1");
        assert_eq!(doc["env"]["ANTHROPIC_BASE_URL"], "https://relay.example");
        assert_eq!(doc["env"]["ANTHROPIC_AUTH_TOKEN"], "tok");
        assert!(doc["env"].get("ANTHROPIC_API_KEY").is_none());
    }

    /// claude-account 新建配置的 raw_settings 恒为 "{}"（平凡快照）：应用只清账号覆写键
    /// 与 apiKeyHelper，permissions 等用户现场和其他 env 键保留。
    #[test]
    fn account_profile_apply_clears_overrides_and_keeps_user_settings() {
        let (home, context) = test_context();
        let settings = home.path().join(".claude/settings.json");
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        std::fs::write(
            &settings,
            r#"{"permissions":{"allow":["Read"]},"apiKeyHelper":"fixture-helper",
                "env":{"ANTHROPIC_AUTH_TOKEN":"stale","ANTHROPIC_API_KEY":"stale-key",
                    "CLAUDE_CODE_OAUTH_TOKEN":"override","KEEP":"1"}}"#,
        )
        .unwrap();
        let created = context
            .claude_save(
                None,
                ClaudeProfileInput {
                    name: "账号".into(),
                    kind: Some("claude-account".into()),
                    ..Default::default()
                },
            )
            .unwrap();
        assert_eq!(created.raw_settings.as_deref(), Some("{}"));
        context.claude_apply(&created.id).unwrap();

        let doc = read_settings(&home);
        assert_eq!(doc["permissions"]["allow"][0], "Read");
        assert_eq!(doc["env"]["KEEP"], "1");
        for key in [
            "ANTHROPIC_AUTH_TOKEN",
            "ANTHROPIC_API_KEY",
            "CLAUDE_CODE_OAUTH_TOKEN",
        ] {
            assert!(doc["env"].get(key).is_none(), "{key} 应被清");
        }
        assert!(doc.get("apiKeyHelper").is_none());
    }

    /// 非平凡快照（捕获/全文编辑过、带 env 之外的顶层键）维持整文件替换语义。
    #[test]
    fn nontrivial_snapshot_still_replaces_whole_file() {
        let (home, context) = test_context();
        let settings = home.path().join(".claude/settings.json");
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        std::fs::write(
            &settings,
            r#"{"permissions":{"allow":["Read"]},"env":{"ANTHROPIC_AUTH_TOKEN":"stale","KEEP":"1"}}"#,
        )
        .unwrap();
        let raw = r#"{"model":"opus","env":{"ANTHROPIC_BASE_URL":"https://relay.example","ANTHROPIC_AUTH_TOKEN":"tok"}}"#;
        let created = context
            .claude_save(
                None,
                ClaudeProfileInput {
                    name: "捕获".into(),
                    raw_settings: Some(raw.into()),
                    ..Default::default()
                },
            )
            .unwrap();
        context.claude_apply(&created.id).unwrap();
        assert_eq!(
            std::fs::read_to_string(home.path().join(".claude/settings.json")).unwrap(),
            raw
        );
    }

    /// 存量行（无 raw_settings）走 merge：token 按 kind 落键（对齐前端 patchEnvFields），
    /// 另一形态的手写键撤下，不留两个 token 键并存。
    #[test]
    fn merge_path_token_key_follows_kind_and_retracts_other_form() {
        let (home, context) = test_context();
        let settings = home.path().join(".claude/settings.json");
        std::fs::create_dir_all(settings.parent().unwrap()).unwrap();
        std::fs::write(
            &settings,
            r#"{"env":{"ANTHROPIC_AUTH_TOKEN":"old","ANTHROPIC_API_KEY":"stale"}}"#,
        )
        .unwrap();

        let relay = context
            .database
            .insert_claude_profile(
                &draft("中转", Some("https://relay.example"), Some("tok"), None),
                "1",
            )
            .unwrap();
        context.claude_apply(&relay.id).unwrap();
        let doc = read_settings(&home);
        assert_eq!(doc["env"]["ANTHROPIC_AUTH_TOKEN"], "tok");
        assert!(doc["env"].get("ANTHROPIC_API_KEY").is_none());

        let official = context
            .database
            .insert_claude_profile(
                &ClaudeProfileInput {
                    kind: Some("anthropic".into()),
                    ..draft("官方", Some("https://official.example"), Some("key"), None)
                },
                "2",
            )
            .unwrap();
        context.claude_apply(&official.id).unwrap();
        let doc = read_settings(&home);
        assert_eq!(doc["env"]["ANTHROPIC_API_KEY"], "key");
        assert!(doc["env"].get("ANTHROPIC_AUTH_TOKEN").is_none());
    }

    /// 名称/描述接入与 Codex 侧相同的长度校验：>50 字节名字、>200 字符描述直接拒绝。
    #[test]
    fn save_rejects_overlong_name_and_description() {
        let (_home, context) = test_context();
        assert!(context
            .claude_save(None, draft(&"名".repeat(51), None, None, None))
            .is_err());
        assert!(context
            .claude_save(
                None,
                ClaudeProfileInput {
                    description: Some("述".repeat(201)),
                    ..draft("A", None, None, None)
                }
            )
            .is_err());
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
        assert_eq!(order, vec![b.id, a.id.clone(), copy.id]);

        // 撞名追加序号从 copy 2 起（与 Codex duplicate_profile 共用 unique_copy_name）
        let copy2 = context.claude_duplicate(&a.id).unwrap();
        assert_eq!(copy2.name, "A copy 2");
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
