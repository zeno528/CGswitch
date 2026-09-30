use super::{
    app_err, atomic_write, backup_file, codex_config, now_ms, AppContext, AppResult, BTreeMap,
    McpDiffEntryAction, McpServerSpec, McpSyncDiffEntry, McpSyncEntryKind, McpSyncPreview,
};
use crate::database::McpServerRecord;
use crate::services::plugins::SkillTool;

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

    fn codex_active_fragments(records: &[McpServerRecord]) -> Vec<(String, String)> {
        records
            .iter()
            .filter(|record| record.codex_enabled)
            .map(|record| (record.name.clone(), record.toml.clone()))
            .collect()
    }

    pub(super) fn claude_active_fragments(records: &[McpServerRecord]) -> Vec<(String, String)> {
        records
            .iter()
            .filter(|record| record.claude_enabled)
            .map(|record| (record.name.clone(), record.toml.clone()))
            .collect()
    }

    /// 强制替换数据库镜像的 Codex 活跃集（应用自身的管理操作走这里，允许清空到零）。
    pub(super) fn replace_mcp_mirror(&self, fragments: &[(String, String)]) -> AppResult<()> {
        let previous_records = self.database.mcp_server_records()?;
        if Self::codex_active_fragments(&previous_records) != fragments {
            self.database
                .replace_mcp_server_fragments(fragments, &now_ms().to_string())?;
            let current_records = self.database.mcp_server_records()?;
            // MCP 是应用级共享配置：镜像更新后把 Claude 活跃子集同步到 Claude Code 用户范围文件，
            // 不把服务器复制到每个供应商的 settings.json；Codex live 由各调用方自行写入。
            self.sync_claude_mcp_projection(
                &Self::claude_active_fragments(&previous_records),
                &Self::claude_active_fragments(&current_records),
            )?;
        }
        Ok(())
    }

    /// 新供应商使用数据库镜像；首次尚无镜像时才读取 live MCP 段（同样滤除托管条目）。
    pub(super) fn mcp_document_for_new_profile(&self) -> AppResult<toml_edit::DocumentMut> {
        let records = self.database.mcp_server_records()?;
        let fragments = Self::codex_active_fragments(&records);
        if records.is_empty() {
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

    /// 把数据库镜像的 MCP 段写进 live config.toml；写前照常自动备份原文件。
    /// 建模字段与 live 一致的服务器保留 live 原文：注释/未建模键跟随 live，
    /// 恢复动作只覆盖真有差异的条目，不做整段格式回滚。
    ///
    /// live 解析失败时**只做文本层面 MCP 区域的重建**，区域外逐字节保留。
    /// 定位不到 MCP 区域就如实报错——整份重写会连带丢掉区域外的 projects /
    /// plugins / desktop 等全部配置，代价远高于收益，那种情况该走备份恢复。
    pub(super) fn write_mcp_section_to_live(
        &self,
        fragments: &[(String, String)],
    ) -> AppResult<()> {
        let live_text = self.read_live_config()?;
        let text = match codex_config::parse_document(&live_text) {
            Ok(mut document) => {
                let live_fragments = codex_config::mcp_server_fragments_from_document(&document);
                let live_specs: BTreeMap<String, McpServerSpec> =
                    codex_config::mcp_servers_from_document(&document)
                        .into_iter()
                        .map(|spec| (spec.name.clone(), spec))
                        .collect();
                let merged = fragments
                    .iter()
                    .map(|(name, toml)| {
                        let semantically_equal = live_specs.get(name).is_some_and(|live| {
                            codex_config::spec_from_fragment(name, toml)
                                .is_some_and(|db| *live == db)
                        });
                        if semantically_equal {
                            live_fragments
                                .iter()
                                .find(|(live_name, _)| live_name == name)
                                .cloned()
                                .unwrap_or_else(|| (name.clone(), toml.clone()))
                        } else {
                            (name.clone(), toml.clone())
                        }
                    })
                    .collect::<Vec<_>>();
                codex_config::replace_mcp_section_from_fragments(&mut document, &merged);
                codex_config::normalize_global_section_order(&document.to_string())
            }
            Err(_) => {
                let repaired = codex_config::rebuild_mcp_region_text(&live_text, fragments)
                    .ok_or_else(|| {
                        app_err!("config.toml 中定位不到 MCP 段，无法就地重建；请改用备份恢复")
                    })?;
                // 修完必须能解析才允许落盘：改不动就报错，不做"尽力而为地写下去"
                codex_config::parse_document(&repaired)
                    .map_err(|error| app_err!("重建 MCP 段后配置仍无法解析：{error}"))?;
                repaired
            }
        };
        let config_path = self.paths.codex_config();
        backup_file(&config_path, &self.paths.config_backup, "config")?;
        atomic_write(&config_path, text.as_bytes())?;
        Ok(())
    }

    /// 把改好的 live config.toml 文档落盘：备份一次 + 原子写入（含全局段排序归一）。
    fn write_live_config_document(&self, document: &toml_edit::DocumentMut) -> AppResult<()> {
        let config_path = self.paths.codex_config();
        backup_file(&config_path, &self.paths.config_backup, "config")?;
        atomic_write(
            &config_path,
            codex_config::normalize_global_section_order(&document.to_string()).as_bytes(),
        )
    }

    /// 数据库镜像写回 live config.toml（备份恢复后调用；旧备份无 MCP 表则不动 live）。
    pub(super) fn write_mcp_to_live_from_database(&self) -> AppResult<()> {
        let records = self.database.mcp_server_records()?;
        if records.is_empty() {
            return Ok(());
        }
        self.write_mcp_section_to_live(&Self::codex_active_fragments(&records))?;
        self.sync_claude_mcp_projection(&[], &Self::claude_active_fragments(&records))
    }

    /// 读取 live config.toml 中的全部 MCP 服务器（只读，不随供应商切换）。
    pub fn list_mcp_servers(&self) -> AppResult<Vec<McpServerSpec>> {
        let document = codex_config::parse_document(&self.read_live_config()?)?;
        let mut servers = codex_config::mcp_servers_from_document(&document);
        for record in self.database.mcp_server_records()? {
            if record.codex_enabled {
                continue;
            }
            let name = record.name.as_str();
            if let Some(server) = servers.iter_mut().find(|server| server.name == name) {
                server.enabled = Some(false);
                continue;
            }
            if let Some(mut server) = codex_config::spec_from_fragment(name, &record.toml) {
                server.enabled = Some(false);
                servers.push(server);
            }
        }
        Ok(servers)
    }

    /// 读取指定 MCP 服务器的原始片段（含未建模键与注释；编辑页初始化编辑器用）。
    pub fn mcp_server_toml(&self, name: &str) -> AppResult<Option<String>> {
        let document = codex_config::parse_document(&self.read_live_config()?)?;
        if let Some(fragment) = codex_config::mcp_server_fragments_from_document(&document)
            .into_iter()
            .find(|(fragment_name, _)| fragment_name == name)
            .map(|(_, toml)| toml)
        {
            return Ok(Some(fragment));
        }
        Ok(self
            .database
            .mcp_server_record(name)?
            .filter(|record| !record.codex_enabled)
            .map(|record| record.toml))
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
        let db_fragments: Vec<(String, String)> =
            Self::codex_active_fragments(&self.database.mcp_server_records()?)
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

        let mut entries = Vec::new();
        for (name, live_toml) in &live_fragments {
            let live_spec = live_specs.get(name).cloned();
            let Some(db_toml) = db_map.get(name.as_str()) else {
                entries.push(McpSyncDiffEntry {
                    name: name.clone(),
                    kind: McpSyncEntryKind::LiveOnly,
                    live_spec,
                    db_spec: None,
                    live_toml: Some(live_toml.clone()),
                    db_toml: None,
                });
                continue;
            };
            if without_blank_lines(live_toml) == without_blank_lines(db_toml) {
                continue;
            }
            let db_spec = codex_config::spec_from_fragment(name, db_toml);
            // 建模字段全部相等 = 语义等价（差异只在注释/格式/未建模键），不构成差异：
            // 展示会诱导无意义的“同步”，写回反而会回滚 live 侧的注释与未建模键。
            // 展示按行对比（前端做），这里的判定仍按建模字段——故用 == 而非文本比较。
            if let (Some(live), Some(db)) = (&live_spec, &db_spec) {
                if live == db {
                    continue;
                }
            }
            entries.push(McpSyncDiffEntry {
                name: name.clone(),
                kind: McpSyncEntryKind::Changed,
                live_spec,
                db_spec,
                live_toml: Some(live_toml.clone()),
                db_toml: Some((*db_toml).to_string()),
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
                live_spec: None,
                db_spec: codex_config::spec_from_fragment(name, db_toml),
                live_toml: None,
                db_toml: Some(db_toml.clone()),
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
        let records = self.database.mcp_server_records()?;
        if records.is_empty() {
            return Err(app_err!("数据库中没有 MCP 镜像可恢复"));
        }
        let fragments = Self::codex_active_fragments(&records);
        let count = fragments.len();
        self.write_mcp_section_to_live(&fragments)?;
        self.sync_claude_mcp_projection(&[], &Self::claude_active_fragments(&records))?;
        tauri_plugin_log::log::info!(
            "[mcp.config.restore] outcome=success count={count} msg=\"已从数据库恢复 MCP 配置\""
        );
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
        self.save_mcp_server_with_fragment(original_name, spec, None, SkillTool::Codex)
    }

    /// 编辑页保存：fragment = 编辑器当前片段。有片段时以它整表替换 live 里的该服务器
    /// （未建模键、注释与编辑器所见一致——所见即所得），建模字段先按 spec 补齐兜底；
    /// 无片段（纯表单路径）退回就地 upsert。
    /// 按引擎区分：在保存方引擎上编辑已关闭条目等同重新启用；另一引擎的开关与 live 文件不动。
    pub fn save_mcp_server_with_fragment(
        &self,
        original_name: Option<&str>,
        spec: McpServerSpec,
        fragment: Option<&str>,
        tool: SkillTool,
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
        let existing = self
            .database
            .mcp_server_record(original_name.unwrap_or(spec.name.as_str()))?;
        let codex_off = existing
            .as_ref()
            .is_some_and(|record| !record.codex_enabled);
        if existing
            .as_ref()
            .is_some_and(|record| !record.codex_enabled || !record.claude_enabled)
        {
            // 任一引擎关闭时都不落 Codex 原生 enabled 键，避免 enabled=false 把恢复的条目再次停用
            spec.enabled = None;
        }
        let mut document = codex_config::parse_document(&self.read_live_config()?)?;
        // 重命名 = 先删旧条目再以新名写入；查重随之按新名判定。
        // 旧行直接从镜像删除，避免整表重写时被"保留 Codex 关闭行"的规则复活；
        // 旧名的 Claude 投影也随之撤下（提前删行后镜像同步已看不到旧名，不会自动清）。
        if let Some(original) = original_name.filter(|original| original != &spec.name) {
            codex_config::remove_mcp_server(&mut document, original)?;
            self.database.delete_mcp_server(original)?;
            self.remove_claude_mcp_entry(original)?;
        }
        let name_taken = document
            .as_table()
            .get("mcp_servers")
            .and_then(toml_edit::Item::as_table)
            .is_some_and(|servers| servers.contains_key(&spec.name));
        if name_taken && original_name != Some(spec.name.as_str()) {
            return Err(app_err!("已存在同名 MCP 服务器"));
        }

        // Codex 端已关闭且本次保存来自 Claude 页：不动 config.toml，只把片段更新进镜像
        let write_codex_live = !codex_off || tool == SkillTool::Codex;
        let mut fragments = codex_config::mcp_server_fragments_from_document(&document);
        if write_codex_live {
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
            self.write_live_config_document(&document)?;
            fragments = codex_config::mcp_server_fragments_from_document(&document);
        } else {
            let fragment = match fragment {
                Some(fragment) => fragment.to_string(),
                None => codex_config::patch_mcp_fragment("", &spec)?,
            };
            fragments.retain(|(name, _)| name != &spec.name);
            fragments.push((spec.name.clone(), fragment));
        }
        self.replace_mcp_mirror(&fragments)?;
        // 在保存方引擎上，编辑已关闭条目等同重新启用
        match tool {
            SkillTool::Codex if codex_off => {
                self.database.set_codex_mcp_enabled(&spec.name, true)?
            }
            SkillTool::Claude
                if existing
                    .as_ref()
                    .is_some_and(|record| !record.claude_enabled) =>
            {
                self.database.set_claude_mcp_enabled(&spec.name, true)?
            }
            _ => {}
        }
        tauri_plugin_log::log::info!(
            "[mcp.config.save] server={:?} outcome=success msg=\"MCP 配置已保存\"",
            spec.name
        );
        Ok(())
    }

    /// 切换引擎级 MCP 开关：只影响该引擎的用户范围 live 文件（Codex=config.toml，Claude=.claude.json），
    /// 数据库片段保留；另一引擎的开关与 live 文件不动。项目级配置从不在这里改写。
    pub fn set_mcp_server_enabled(
        &self,
        name: &str,
        tool: SkillTool,
        enabled: bool,
    ) -> AppResult<()> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        if codex_config::is_managed_mcp_name(name) {
            return Err(app_err!("「{name}」由 Codex 官方应用自动管理，不能切换"));
        }

        let mut records = self.database.mcp_server_records()?;
        if !records.iter().any(|record| record.name == name) {
            // 镜像还没有这台：从对应引擎的 live 现场导入
            let live = match tool {
                SkillTool::Codex => {
                    let document = codex_config::parse_document(&self.read_live_config()?)?;
                    codex_config::mcp_server_fragments_from_document(&document)
                }
                SkillTool::Claude => self.claude_mcp_fragments_from_live()?,
            };
            if !live.iter().any(|(server_name, _)| server_name == name) {
                return Err(app_err!("MCP 服务器不存在: {name}"));
            }
            self.replace_mcp_mirror(&live)?;
            records = self.database.mcp_server_records()?;
        }
        let record = records
            .into_iter()
            .find(|record| record.name == name)
            .ok_or_else(|| app_err!("MCP 服务器不存在: {name}"))?;
        let already = match tool {
            SkillTool::Codex => record.codex_enabled,
            SkillTool::Claude => record.claude_enabled,
        };
        // 开关已是要的状态时通常直接返回；唯一例外：Codex 开关是开、但片段里残留
        // 原生 enabled=false（导入/采纳带进来的）——UI 开关显示关，必须借这次点击
        // 走启用分支把键剥掉，否则用户点"打开"毫无反应。
        let native_disabled = tool == SkillTool::Codex
            && record.codex_enabled
            && codex_config::spec_from_fragment(name, &record.toml)
                .is_some_and(|spec| spec.enabled == Some(false));
        if already == enabled && !(enabled && native_disabled) {
            return Ok(());
        }

        match (tool, enabled) {
            (SkillTool::Codex, true) => {
                // 开关只控制条目是否存在；恢复启用时移除 Codex 原生 enabled 键，
                // 避免历史遗留的 enabled=false 把刚恢复的条目再次停用。
                let mut spec = codex_config::spec_from_fragment(name, &record.toml)
                    .ok_or_else(|| app_err!("MCP 服务器 {name} 的共享片段无法解析"))?;
                spec.enabled = None;
                let fragment = codex_config::patch_mcp_fragment(&record.toml, &spec)?;
                let document = codex_config::parse_document(&self.read_live_config()?)?;
                let mut live = codex_config::mcp_server_fragments_from_document(&document);
                live.retain(|(server_name, _)| server_name != name);
                live.push((name.to_string(), fragment.clone()));
                self.write_mcp_section_to_live(&live)?;
                // 剥离后的片段同步写回镜像：镜像若留原文（含原生 enabled 键），
                // 语义比会把应用自己的开关操作误报成"已修改"差异
                let mut mirror = Self::codex_active_fragments(&self.database.mcp_server_records()?);
                mirror.retain(|(existing, _)| existing != name);
                mirror.push((name.to_string(), fragment));
                self.replace_mcp_mirror(&mirror)?;
                self.database.set_codex_mcp_enabled(name, true)?;
            }
            (SkillTool::Codex, false) => {
                let mut document = codex_config::parse_document(&self.read_live_config()?)?;
                let present = codex_config::mcp_server_fragments_from_document(&document)
                    .iter()
                    .any(|(server_name, _)| server_name == name);
                if present {
                    codex_config::remove_mcp_server(&mut document, name)?;
                    self.write_live_config_document(&document)?;
                }
                self.database.set_codex_mcp_enabled(name, false)?;
            }
            (SkillTool::Claude, true) => {
                self.database.set_claude_mcp_enabled(name, true)?;
                // 把 Claude 活跃集（现在含这台）投影回 .claude.json
                self.ensure_claude_mcp_projection()?;
            }
            (SkillTool::Claude, false) => {
                self.database.set_claude_mcp_enabled(name, false)?;
                self.remove_claude_mcp_entry(name)?;
            }
        }
        tauri_plugin_log::log::info!(
            "[mcp.config.toggle] server={name:?} tool={:?} enabled={enabled} outcome=success msg=\"MCP 引擎开关已更新\"",
            tool
        );
        Ok(())
    }

    /// 差异处理"同步"原语（单条）：见 set_mcp_mirror_entries。
    pub fn set_mcp_mirror_entry(&self, name: &str, fragment: Option<&str>) -> AppResult<()> {
        self.set_mcp_mirror_entries(&[McpDiffEntryAction {
            name: name.to_string(),
            fragment: fragment.map(str::to_string),
        }])
        .map(|_| ())
    }

    /// 差异处理"同步"原语：把若干条目一次写进数据库镜像——fragment=Some 用 live 片段覆盖该条，
    /// fragment=None 删除该条（"外部已删除"的同步）。整批校验通过才落一次盘，任一条非法整批不写。
    /// 只碰镜像，不触碰 live；不能用 save_mcp_server / delete_mcp_server 代替：前者会用整段 live
    /// 重建镜像、殃及其他未处理差异，后者会因条目已不在 live 而报错。
    pub fn set_mcp_mirror_entries(&self, actions: &[McpDiffEntryAction]) -> AppResult<usize> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        if actions.is_empty() {
            return Ok(0);
        }
        let mut fragments = Self::codex_active_fragments(&self.database.mcp_server_records()?);
        for action in actions {
            let name = action.name.as_str();
            if codex_config::is_managed_mcp_name(name) {
                return Err(app_err!(
                    "「{name}」由 Codex 官方应用自动管理，不能改写数据库镜像"
                ));
            }
            fragments.retain(|(existing, _)| existing != name);
            if let Some(fragment) = &action.fragment {
                if codex_config::spec_from_fragment(name, fragment).is_none() {
                    return Err(app_err!("片段无法解析为 MCP 服务器 {name}"));
                }
                fragments.push((action.name.clone(), fragment.clone()));
            }
        }
        self.replace_mcp_mirror(&fragments)?;
        for action in actions.iter().filter(|action| action.fragment.is_none()) {
            self.database.delete_mcp_server(&action.name)?;
        }
        // 采纳（fragment=Some）外部加回 live 的条目 = 接受它在 Codex 端启用的事实：
        // 不翻开开关的话该行会卡在"live 有条目、开关却是关"的状态，差异也永远消不掉
        for action in actions.iter().filter(|action| action.fragment.is_some()) {
            if self
                .database
                .mcp_server_record(&action.name)?
                .is_some_and(|record| !record.codex_enabled)
            {
                self.database.set_codex_mcp_enabled(&action.name, true)?;
            }
        }
        tauri_plugin_log::log::info!(
            "[mcp.diff.batch] source=mirror count={} outcome=success msg=\"已把外部 MCP 修改写入数据库镜像\"",
            actions.len()
        );
        Ok(actions.len())
    }

    /// 差异处理"撤销"原语（单条）：见 revert_mcp_live_entries。
    pub fn revert_mcp_live_entry(&self, name: &str, fragment: Option<&str>) -> AppResult<()> {
        self.revert_mcp_live_entries(&[McpDiffEntryAction {
            name: name.to_string(),
            fragment: fragment.map(str::to_string),
        }])
        .map(|_| ())
    }

    /// 差异处理"撤销"原语：把若干条目一次写回 live config.toml——fragment=Some 恢复为数据库内容，
    /// fragment=None 从 live 移除。逐条原地改写：只动列出的条目，其余条目、其他配置段、
    /// 段内既有顺序与文件布局全部原样保留。整批改完才备份并写一次盘，任一条失败整批不写
    /// （逐条调用会各备份一次，把保留池里操作前的备份挤掉）。
    /// 不能走 write_mcp_section_to_live——那是整段替换语义，会清掉 live 里其他服务器并重排段内条目。
    pub fn revert_mcp_live_entries(&self, actions: &[McpDiffEntryAction]) -> AppResult<usize> {
        let _guard = self
            .operation
            .lock()
            .map_err(|_| app_err!("操作锁已损坏"))?;
        if actions.is_empty() {
            return Ok(0);
        }
        let mut document = codex_config::parse_document(&self.read_live_config()?)?;
        for action in actions {
            let name = action.name.as_str();
            if codex_config::is_managed_mcp_name(name) {
                return Err(app_err!("「{name}」由 Codex 官方应用自动管理，不能回退"));
            }
            let Some(fragment) = &action.fragment else {
                codex_config::remove_mcp_server(&mut document, name)?;
                continue;
            };
            // 恢复 = 把数据库片段合并进现有 live 文档：只动这一个条目，其余条目原样保留
            let mut fragment_doc = codex_config::parse_document(fragment)?;
            let table = fragment_doc
                .as_table_mut()
                .get_mut("mcp_servers")
                .and_then(toml_edit::Item::as_table_mut)
                .and_then(|servers| servers.remove(name))
                .ok_or_else(|| app_err!("片段中没有可恢复的服务器 {name}"))?;
            document
                .as_table_mut()
                .entry("mcp_servers")
                .or_insert_with(|| toml_edit::Item::Table(toml_edit::Table::new()))
                .as_table_mut()
                .ok_or_else(|| app_err!("mcp_servers 不是 TOML table"))?
                .insert(name, table);
        }
        self.write_live_config_document(&document)?;
        tauri_plugin_log::log::info!(
            "[mcp.diff.batch] source=live count={} outcome=success msg=\"已把数据库 MCP 配置写回 live\"",
            actions.len()
        );
        Ok(actions.len())
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
        let has_record = self.database.mcp_server_record(name)?.is_some();
        let mut document = codex_config::parse_document(&self.read_live_config()?)?;
        let present = codex_config::mcp_server_fragments_from_document(&document)
            .iter()
            .any(|(server_name, _)| server_name == name);
        if !present && !has_record {
            return Err(app_err!("MCP 服务器不存在: {name}"));
        }
        if present {
            codex_config::remove_mcp_server(&mut document, name)?;
            self.write_live_config_document(&document)?;
        }
        self.replace_mcp_mirror(&codex_config::mcp_server_fragments_from_document(&document))?;
        self.database.delete_mcp_server(name)?;
        self.remove_claude_mcp_entry(name)?;
        tauri_plugin_log::log::info!(
            "[mcp.config.delete] server={name:?} outcome=success msg=\"MCP 配置已删除\""
        );
        Ok(())
    }
}
