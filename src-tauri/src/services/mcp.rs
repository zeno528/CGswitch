use super::{
    app_err, atomic_write, backup_file, codex_config, now_ms, AppContext, AppResult, BTreeMap,
    McpServerSpec, McpSyncDiffEntry, McpSyncEntryKind, McpSyncFieldDiff, McpSyncPreview,
};

fn without_blank_lines(text: &str) -> String {
    text.lines()
        .filter(|line| {
            let line = line.trim();
            !line.is_empty() && line != "[mcp_servers]"
        })
        .collect::<Vec<_>>()
        .join("\n")
}

impl AppContext {
    /// 读取 live config.toml；文件不存在视作空文档（首个 MCP 服务器创建前允许没有配置文件）。
    pub(super) fn read_live_config(&self) -> AppResult<String> {
        let path = self.paths.codex_config();
        match std::fs::read_to_string(&path) {
            Ok(text) => Ok(text),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
            Err(error) => Err(app_err!("无法读取 {}: {error}", path.display())),
        }
    }

    /// 强制替换数据库镜像（应用自身的管理操作走这里，允许清空到零）。
    pub(super) fn replace_mcp_mirror(&self, fragments: &[(String, String)]) -> AppResult<()> {
        if self.database.mcp_server_fragments()? != fragments {
            self.database
                .replace_mcp_server_fragments(fragments, &now_ms().to_string())?;
        }
        Ok(())
    }

    /// 新供应商使用数据库镜像；首次尚无镜像时才读取 live MCP 段（同样滤除托管条目）。
    pub(super) fn mcp_document_for_new_profile(&self) -> AppResult<toml_edit::DocumentMut> {
        let fragments = self.database.mcp_server_fragments()?;
        if fragments.is_empty() {
            let live = codex_config::parse_document(&self.read_live_config()?)?;
            let live_fragments = codex_config::mcp_server_fragments_from_document(&live);
            let mut document = toml_edit::DocumentMut::new();
            codex_config::replace_mcp_section_from_fragments(&mut document, &live_fragments);
            return Ok(document);
        }
        let mut document = toml_edit::DocumentMut::new();
        codex_config::replace_mcp_section_from_fragments(&mut document, &fragments);
        Ok(document)
    }

    /// 把数据库镜像的 MCP 段写进 live config.toml。
    /// live 解析失败（损坏/被重置）时从镜像重建整个文件；写前照常自动备份原文件。
    pub(super) fn write_mcp_section_to_live(
        &self,
        fragments: &[(String, String)],
    ) -> AppResult<()> {
        let live_text = self.read_live_config()?;
        let mut document = match codex_config::parse_document(&live_text) {
            Ok(document) => document,
            Err(_) => toml_edit::DocumentMut::new(),
        };
        codex_config::replace_mcp_section_from_fragments(&mut document, fragments);
        let config_path = self.paths.codex_config();
        backup_file(&config_path, &self.paths.config_backup, "config")?;
        atomic_write(
            &config_path,
            codex_config::normalize_global_section_order(&document.to_string()).as_bytes(),
        )?;
        Ok(())
    }

    /// 数据库镜像写回 live config.toml（备份恢复后调用；旧备份无 MCP 表则不动 live）。
    pub(super) fn write_mcp_to_live_from_database(&self) -> AppResult<()> {
        let fragments = self.database.mcp_server_fragments()?;
        if fragments.is_empty() {
            return Ok(());
        }
        self.write_mcp_section_to_live(&fragments)
    }

    /// 读取 live config.toml 中的全部 MCP 服务器（只读，不随供应商切换）。
    pub fn list_mcp_servers(&self) -> AppResult<Vec<McpServerSpec>> {
        let document = codex_config::parse_document(&self.read_live_config()?)?;
        Ok(codex_config::mcp_servers_from_document(&document))
    }

    /// 读取指定 MCP 服务器的原始片段（含未建模键与注释；编辑页初始化编辑器用）。
    pub fn mcp_server_toml(&self, name: &str) -> AppResult<Option<String>> {
        let document = codex_config::parse_document(&self.read_live_config()?)?;
        Ok(codex_config::mcp_server_fragments_from_document(&document)
            .into_iter()
            .find(|(fragment_name, _)| fragment_name == name)
            .map(|(_, toml)| toml))
    }

    /// 对比 live config.toml 与数据库镜像的 MCP 差异（只读，不写任何一侧），
    /// 供同步前人工裁决。live 无法解析时返回错误，前端进入“仅可从数据库恢复”降级模式。
    pub fn mcp_sync_preview(&self) -> AppResult<McpSyncPreview> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        let document = codex_config::parse_document(&self.read_live_config()?)?;
        let live_fragments = codex_config::mcp_server_fragments_from_document(&document);
        // 旧镜像可能残留 Codex 托管条目（node_repl）的片段：过滤掉，避免误报“仅数据库有”
        let db_fragments: Vec<(String, String)> = self
            .database
            .mcp_server_fragments()?
            .into_iter()
            .filter(|(name, _)| !codex_config::is_managed_mcp_name(name))
            .collect();
        let db_map: BTreeMap<&str, &str> = db_fragments
            .iter()
            .map(|(name, toml)| (name.as_str(), toml.as_str()))
            .collect();
        let live_specs: BTreeMap<String, McpServerSpec> =
            codex_config::mcp_servers_from_document(&document)
                .into_iter()
                .map(|spec| (spec.name.clone(), spec))
                .collect();

        // 建模字段（除 name 外共 10 项）序列化后逐项比对，顺序即前端展示顺序
        fn field_values(spec: &McpServerSpec) -> Vec<(&'static str, serde_json::Value)> {
            fn value<T: serde::Serialize>(field: &T) -> serde_json::Value {
                serde_json::to_value(field).unwrap_or(serde_json::Value::Null)
            }
            vec![
                ("enabled", value(&spec.enabled)),
                ("startup_timeout_sec", value(&spec.startup_timeout_sec)),
                ("tool_timeout_sec", value(&spec.tool_timeout_sec)),
                ("command", value(&spec.command)),
                ("args", value(&spec.args)),
                ("env", value(&spec.env)),
                ("url", value(&spec.url)),
                ("bearer_token_env_var", value(&spec.bearer_token_env_var)),
                ("http_headers", value(&spec.http_headers)),
                ("env_http_headers", value(&spec.env_http_headers)),
            ]
        }

        let mut entries = Vec::new();
        for (name, live_toml) in &live_fragments {
            let live_spec = live_specs.get(name).cloned();
            let Some(db_toml) = db_map.get(name.as_str()) else {
                entries.push(McpSyncDiffEntry {
                    name: name.clone(),
                    kind: McpSyncEntryKind::LiveOnly,
                    unmodeled_only: false,
                    live_spec,
                    db_spec: None,
                    live_toml: Some(live_toml.clone()),
                    db_toml: None,
                    changed_fields: Vec::new(),
                });
                continue;
            };
            if without_blank_lines(live_toml) == without_blank_lines(db_toml) {
                continue;
            }
            let db_spec = codex_config::spec_from_fragment(name, db_toml);
            let mut changed_fields = Vec::new();
            if let (Some(live), Some(db)) = (&live_spec, &db_spec) {
                for ((field, live_value), (_, db_value)) in
                    field_values(live).into_iter().zip(field_values(db))
                {
                    if live_value != db_value {
                        changed_fields.push(McpSyncFieldDiff {
                            field: field.to_string(),
                            live: live_value,
                            db: db_value,
                        });
                    }
                }
            }
            let unmodeled_only =
                changed_fields.is_empty() && live_spec.is_some() && db_spec.is_some();
            entries.push(McpSyncDiffEntry {
                name: name.clone(),
                kind: McpSyncEntryKind::Changed,
                unmodeled_only,
                live_spec,
                db_spec,
                live_toml: Some(live_toml.clone()),
                db_toml: Some((*db_toml).to_string()),
                changed_fields,
            });
        }
        let live_names: std::collections::BTreeSet<&str> = live_fragments
            .iter()
            .map(|(name, _)| name.as_str())
            .collect();
        for (name, db_toml) in &db_fragments {
            if live_names.contains(name.as_str()) {
                continue;
            }
            entries.push(McpSyncDiffEntry {
                name: name.clone(),
                kind: McpSyncEntryKind::DbOnly,
                unmodeled_only: false,
                live_spec: None,
                db_spec: codex_config::spec_from_fragment(name, db_toml),
                live_toml: None,
                db_toml: Some(db_toml.clone()),
                changed_fields: Vec::new(),
            });
        }
        Ok(McpSyncPreview {
            entries,
            live_count: live_fragments.len(),
            db_count: db_fragments.len(),
        })
    }

    /// 用户显式操作：数据库镜像写回 live config.toml（配置损坏/段丢失后的恢复）。
    /// 返回恢复的服务器数量。
    pub fn restore_mcp_from_database(&self) -> AppResult<usize> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        let fragments = self.database.mcp_server_fragments()?;
        if fragments.is_empty() {
            return Err(app_err!("数据库中没有 MCP 镜像可恢复"));
        }
        let count = fragments.len();
        self.write_mcp_section_to_live(&fragments)?;
        Ok(count)
    }

    /// 用户显式操作：把 live 当前 MCP 段强制导入数据库（含清空镜像以对齐 live）。
    /// 返回导入的服务器数量。
    pub fn import_mcp_from_live(&self) -> AppResult<usize> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        let document = codex_config::parse_document(&self.read_live_config()?)?;
        let fragments = codex_config::mcp_server_fragments_from_document(&document);
        let count = fragments.len();
        self.replace_mcp_mirror(&fragments)?;
        Ok(count)
    }

    /// 创建表单预填用：优先数据库 MCP 镜像，首次无镜像时回退 live。
    pub fn mcp_section_toml(&self) -> AppResult<String> {
        Ok(
            codex_config::mcp_server_fragments_from_document(&self.mcp_document_for_new_profile()?)
                .into_iter()
                .map(|(_, toml)| toml)
                .collect(),
        )
    }

    /// 新增/编辑/重命名一个 MCP 服务器：就地修改 live config.toml，未建模键与注释原样保留；
    /// 激活供应商的快照在下次 get_state 时自动吸收（与地址/密钥回写 live 同机制）。
    pub fn save_mcp_server(
        &self,
        original_name: Option<&str>,
        spec: McpServerSpec,
    ) -> AppResult<()> {
        self.save_mcp_server_with_fragment(original_name, spec, None)
    }

    /// 编辑页保存：fragment = 编辑器当前片段。有片段时以它整表替换 live 里的该服务器
    /// （未建模键、注释与编辑器所见一致——所见即所得），建模字段先按 spec 补齐兜底；
    /// 无片段（纯表单路径）退回就地 upsert。
    pub fn save_mcp_server_with_fragment(
        &self,
        original_name: Option<&str>,
        spec: McpServerSpec,
        fragment: Option<&str>,
    ) -> AppResult<()> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;

        let name = spec.name.trim().to_string();
        if name.is_empty() {
            return Err(app_err!("MCP 名称不能为空"));
        }
        if name.len() > 64 {
            return Err(app_err!("MCP 名称过长（最多 64 字符）"));
        }
        if !name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            // 点号会让 [mcp_servers.a.b] 变成嵌套表，空格/引号等也会破坏键名
            return Err(app_err!("MCP 名称只能包含字母、数字、下划线和连字符"));
        }
        if codex_config::is_managed_mcp_name(&name) {
            // Codex 官方应用自动写入并维护（路径带版本哈希，每次更新都会变），编辑必被覆盖
            return Err(app_err!(
                "「{name}」由 Codex 官方应用自动管理，不能在本应用中创建或编辑"
            ));
        }
        if spec.startup_timeout_sec.is_some_and(|timeout| timeout <= 0) {
            return Err(app_err!("启动超时必须为正数（秒）"));
        }
        if spec.tool_timeout_sec.is_some_and(|timeout| timeout <= 0) {
            return Err(app_err!("工具调用超时必须为正数（秒）"));
        }
        let url = spec.url.as_deref().map(str::trim).filter(|v| !v.is_empty());
        let command = spec
            .command
            .as_deref()
            .map(str::trim)
            .filter(|v| !v.is_empty());
        match (url, command) {
            (Some(_), Some(_)) => return Err(app_err!("不能同时填写启动命令和服务地址")),
            (None, None) => {
                return Err(app_err!(
                    "必须填写启动命令（stdio）或服务地址（http）其中之一"
                ))
            }
            (Some(url), None) if !url.starts_with("http://") && !url.starts_with("https://") => {
                return Err(app_err!("服务地址必须以 http:// 或 https:// 开头"));
            }
            _ => {}
        }

        let mut spec = spec;
        spec.name = name;
        let mut document = codex_config::parse_document(&self.read_live_config()?)?;
        // 重命名 = 先删旧条目再以新名写入；查重随之按新名判定
        if let Some(original) = original_name.filter(|original| original != &spec.name) {
            codex_config::remove_mcp_server(&mut document, original)?;
        }
        let name_taken = document
            .as_table()
            .get("mcp_servers")
            .and_then(toml_edit::Item::as_table)
            .is_some_and(|servers| servers.contains_key(&spec.name));
        if name_taken && original_name != Some(spec.name.as_str()) {
            return Err(app_err!("已存在同名 MCP 服务器"));
        }

        if let Some(fragment) = fragment {
            // 片段路径：把建模字段补进片段后整表搬进 live，编辑器所见 = 保存所写
            let patched = codex_config::patch_mcp_fragment(fragment, &spec)?;
            let mut fragment_doc = codex_config::parse_document(&patched)?;
            let table = fragment_doc
                .as_table_mut()
                .get_mut("mcp_servers")
                .and_then(toml_edit::Item::as_table_mut)
                .and_then(|servers| servers.remove(spec.name.as_str()))
                .ok_or_else(|| app_err!("片段中没有可保存的服务器 {}", spec.name))?;
            document
                .as_table_mut()
                .entry("mcp_servers")
                .or_insert_with(|| toml_edit::Item::Table(toml_edit::Table::new()))
                .as_table_mut()
                .ok_or_else(|| app_err!("mcp_servers 不是 TOML table"))?
                .insert(spec.name.as_str(), table);
        } else {
            codex_config::upsert_mcp_server(&mut document, &spec)?;
        }
        let config_path = self.paths.codex_config();
        backup_file(&config_path, &self.paths.config_backup, "config")?;
        atomic_write(
            &config_path,
            codex_config::normalize_global_section_order(&document.to_string()).as_bytes(),
        )?;
        self.replace_mcp_mirror(&codex_config::mcp_server_fragments_from_document(&document))?;
        Ok(())
    }

    /// 删除一个 MCP 服务器（含其全部子表）。
    pub fn delete_mcp_server(&self, name: &str) -> AppResult<()> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        if codex_config::is_managed_mcp_name(name) {
            return Err(app_err!(
                "「{name}」由 Codex 官方应用自动管理，删除后 Codex 会自动重建"
            ));
        }
        let mut document = codex_config::parse_document(&self.read_live_config()?)?;
        codex_config::remove_mcp_server(&mut document, name)?;
        let config_path = self.paths.codex_config();
        backup_file(&config_path, &self.paths.config_backup, "config")?;
        atomic_write(
            &config_path,
            codex_config::normalize_global_section_order(&document.to_string()).as_bytes(),
        )?;
        self.replace_mcp_mirror(&codex_config::mcp_server_fragments_from_document(&document))?;
        Ok(())
    }
}
