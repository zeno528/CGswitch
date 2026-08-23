use super::*;

#[test]
fn live_codex_auth_is_available_for_matching_account_only() {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    let payload =
        URL_SAFE_NO_PAD.encode(br#"{"chatgpt_account_id":"acc-live","email":"live@example.com"}"#);
    let auth = format!(
        r#"{{"auth_mode":"chatgpt","tokens":{{"id_token":"e30.{payload}.sig","access_token":"live-access"}}}}"#
    );
    std::fs::write(paths.codex_home.join("auth.json"), auth).unwrap();

    let context = AppContext::new(paths).unwrap();

    assert_eq!(
        context
            .external_codex_access_token_for_account("acc-live")
            .unwrap()
            .as_deref(),
        Some("live-access")
    );
    assert!(context
        .external_codex_access_token_for_account("acc-other")
        .unwrap()
        .is_none());
}

#[test]
fn connection_error_body_detects_provider_level_failures() {
    let parse = |text: &str| {
        serde_json::from_str::<serde_json::Value>(text)
            .ok()
            .and_then(|json| connections::connection_error_from_body(&json))
    };
    // 智谱风格：HTTP 200 包装 401
    assert_eq!(
        parse(r#"{"code":401,"msg":"令牌已过期或验证不正确","success":false}"#).as_deref(),
        Some("令牌已过期或验证不正确")
    );
    // OpenAI 风格：error.message
    assert_eq!(
        parse(r#"{"error":{"message":"Incorrect API key provided"}}"#).as_deref(),
        Some("Incorrect API key provided")
    );
    // error 为字符串
    assert_eq!(
        parse(r#"{"error":"unauthorized"}"#).as_deref(),
        Some("unauthorized")
    );
    // 字符串业务错误码
    assert_eq!(
        parse(r#"{"code":"401","msg":"invalid key"}"#).as_deref(),
        Some("invalid key")
    );
    // 正常模型列表 / 2xx 业务码不应误判
    assert_eq!(parse(r#"{"data":[{"id":"glm-5.3"}]}"#), None);
    assert_eq!(parse(r#"{"code":200,"msg":"ok","success":true}"#), None);
}

#[test]
fn capture_and_apply_profile_round_trip() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(
        paths.codex_config(),
        r#"
model = "glm-5.3"
model_provider = "ZAI"
model_reasoning_effort = "high"

[mcp_servers.keep]
command = "node"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://api.example"
experimental_bearer_token = "secret"
"#,
    )
    .unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context.capture_profile("GLM High").unwrap();
    std::fs::write(
        context.paths.codex_config(),
        r#"
model = "other-model"
model_provider = "ZAI"
model_reasoning_effort = "low"

[mcp_servers.keep]
command = "node"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://old.example"
experimental_bearer_token = "old"
"#,
    )
    .unwrap();

    context.apply_profile(&profile.id).unwrap();
    let state = context.get_state().unwrap();
    let text = std::fs::read_to_string(context.paths.codex_config()).unwrap();

    assert_eq!(
        state.active_profile_id.as_deref(),
        Some(profile.id.as_str())
    );
    assert!(text.contains("glm-5.3"));
    assert!(text.contains("https://api.example"));
    assert!(text.contains("[mcp_servers.keep]"));
    assert!(context.paths.config_backup.read_dir().unwrap().count() > 0);
}

#[test]
fn apply_profile_autosyncs_accumulated_active_profile() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    let context = AppContext::new(paths).unwrap();
    let write = |text: &str| std::fs::write(context.paths.codex_config(), text).unwrap();

    write(
        r#"
model = "glm-5.3"
model_provider = "ZAI"
model_reasoning_effort = "high"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://api.example"
experimental_bearer_token = "secret"
"#,
    );
    let profile_a = context.capture_profile("A").unwrap();
    // A 显式激活，成为唯一“使用中”来源
    context.apply_profile(&profile_a.id).unwrap();

    // A 使用期间 live 配置累计了新的模型键和 provider 字段
    write(
        r#"
model = "glm-5.3"
model_provider = "ZAI"
model_reasoning_effort = "high"
model_catalog_json = "zai.json"

[mcp_servers.keep]
command = "node"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://api.example"
experimental_bearer_token = "secret"
new_field = "accumulated"
"#,
    );
    std::thread::sleep(std::time::Duration::from_millis(2));
    let profile_b = context.capture_profile("B").unwrap();

    // 切到 B：autosync 应把 A 使用期间的累计改动写回 A 的快照
    context.apply_profile(&profile_b.id).unwrap();

    let stored_a = context.database.profile(&profile_a.id).unwrap();
    assert_eq!(
        stored_a
            .payload
            .model_values
            .get("model_catalog_json")
            .map(|raw| raw.trim().trim_matches('"')),
        Some("zai.json")
    );
    assert!(stored_a
        .payload
        .provider_body
        .as_deref()
        .unwrap()
        .contains("new_field = \"accumulated\""));
    assert_eq!(
        context.get_state().unwrap().active_profile_id.as_deref(),
        Some(profile_b.id.as_str())
    );
}

#[test]
fn capture_sets_active_and_autosyncs_previous() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    let context = AppContext::new(paths).unwrap();
    let write = |text: &str| std::fs::write(context.paths.codex_config(), text).unwrap();

    write(
        r#"
model = "glm-5.3"
model_provider = "ZAI"
model_reasoning_effort = "high"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://api.example"
experimental_bearer_token = "secret"
"#,
    );
    let profile_a = context.capture_profile("A").unwrap();
    assert_eq!(
        context.get_state().unwrap().active_profile_id.as_deref(),
        Some(profile_a.id.as_str())
    );

    // A 使用期间 live 累计了新键，再次捕获 B：A 快照被同步，激活转到 B
    write(
        r#"
model = "glm-5.3"
model_provider = "ZAI"
model_reasoning_effort = "high"
model_catalog_json = "zai.json"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://api.example"
experimental_bearer_token = "secret"
new_field = "accumulated"
"#,
    );
    let profile_b = context.capture_profile("B").unwrap();

    let state = context.get_state().unwrap();
    assert_eq!(
        state.active_profile_id.as_deref(),
        Some(profile_b.id.as_str())
    );
    let stored_a = context.database.profile(&profile_a.id).unwrap();
    assert!(stored_a
        .payload
        .provider_body
        .as_deref()
        .unwrap()
        .contains("new_field = \"accumulated\""));
}

#[test]
fn get_profile_returns_raw_file_contents() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(
        paths.codex_config(),
        r#"
model = "glm-5.3"
model_provider = "ZAI"
model_catalog_json = "zai.json"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://api.example"
experimental_bearer_token = "secret-token"
"#,
    )
    .unwrap();
    std::fs::write(
        paths.codex_home.join("zai.json"),
        r#"{"models":[{"id":"glm-5.3","api_key":"sk-secret"}]}"#,
    )
    .unwrap();
    std::fs::write(
        paths.codex_home.join("auth.json"),
        r#"{"auth_mode":"chatgpt","tokens":{"access_token":"raw-token"}}"#,
    )
    .unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context.capture_profile("ZAI").unwrap();

    // 捕获即设为使用中；先清掉激活状态，验证“未使用”只读库快照
    context.database.set_active_profile(None).unwrap();
    let inactive = context.get_profile(&profile.id).unwrap();
    assert_eq!(inactive.catalog_content, None);
    assert_eq!(inactive.auth_content, None);

    // 使用中：live 文件是唯一事实源
    context.apply_profile(&profile.id).unwrap();
    let detail = context.get_profile(&profile.id).unwrap();

    assert!(detail.config_fragment.contains("experimental_bearer_token"));
    assert!(detail.config_fragment.contains("secret-token"));
    assert!(!detail.config_fragment.contains("••••••••"));
    assert_eq!(detail.api_key.as_deref(), Some("secret-token"));
    assert_eq!(
        detail.catalog_content.as_deref(),
        Some(r#"{"models":[{"id":"glm-5.3","api_key":"sk-secret"}]}"#)
    );
    // 第三方档案不把 live 的 Codex 官方认证预填进编辑页
    assert_eq!(detail.auth_content, None);
}

#[test]
fn active_chatgpt_profile_reads_live_auth_without_empty_override() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(paths.codex_config(), "model = \"gpt-5.6\"\n").unwrap();
    let live_auth = r#"{"auth_mode":"chatgpt","tokens":{"access_token":"live"}}"#;
    std::fs::write(paths.codex_home.join("auth.json"), live_auth).unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context
        .add_builtin_profile("chatgpt", None, None, None, None)
        .unwrap();
    let mut stored = context.database.profile(&profile.id).unwrap();
    stored.payload.raw_auth = Some("{\n}".into());
    context
        .database
        .update_profile(&profile.id, &stored.name, &stored.payload, "2")
        .unwrap();
    context.apply_profile(&profile.id).unwrap();

    let detail = context.get_profile(&profile.id).unwrap();
    assert_eq!(detail.raw_auth, None);
    assert_eq!(detail.auth_content.as_deref(), Some(live_auth));
    assert_eq!(
        std::fs::read_to_string(context.paths.codex_home.join("auth.json")).unwrap(),
        live_auth
    );
}

#[test]
fn update_profile_writes_back_to_active_live_config() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(
        paths.codex_config(),
        r#"
model = "glm-5.3"
model_provider = "ZAI"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://old.example"
experimental_bearer_token = "old-key"
"#,
    )
    .unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context.capture_profile("ZAI").unwrap();
    context.apply_profile(&profile.id).unwrap();
    context
        .update_profile(
            &profile.id,
            "ZAI",
            Some("https://new.example"),
            Some("new-key"),
            None,
        )
        .unwrap();

    let text = std::fs::read_to_string(context.paths.codex_config()).unwrap();
    assert!(text.contains(r#"base_url = "https://new.example""#));
    assert!(text.contains(r#"experimental_bearer_token = "new-key""#));
    assert!(!text.contains("old-key"));

    let detail = context.get_profile(&profile.id).unwrap();
    assert_eq!(detail.base_url.as_deref(), Some("https://new.example"));
    assert_eq!(detail.api_key.as_deref(), Some("new-key"));
}

#[test]
fn only_exposed_paths_can_be_opened() {
    let home = tempfile::tempdir().unwrap();
    let context = AppContext::new(crate::paths::from_home(home.path()).unwrap()).unwrap();

    // 设置页只暴露三处：应用数据目录 / Codex 配置 / 备份目录（见 path_info）
    assert!(context.is_managed_path(&context.paths.root.display().to_string()));
    assert!(context.is_managed_path(&context.paths.codex_config().display().to_string()));
    assert!(context.is_managed_path(&context.paths.root.join("backups").display().to_string()));
    // 未单独暴露的具体文件路径不在白名单内，open_path 应拒绝
    assert!(!context.is_managed_path(&context.paths.database.display().to_string()));
    assert!(!context.is_managed_path("C:\\unmanaged-path"));
}

#[test]
fn update_profile_allows_duplicate_name() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(paths.codex_config(), "model = \"glm-5.3\"\n").unwrap();

    let context = AppContext::new(paths).unwrap();
    context.capture_profile("First").unwrap();
    // 供应商 id 取毫秒时间戳，同毫秒内二次捕获会撞 id；真实 UI 不可能，测试里隔开
    std::thread::sleep(std::time::Duration::from_millis(2));
    let second = context.capture_profile("Second").unwrap();

    // 名字不是唯一键，重命名为已存在的名字应允许，靠 ID 区分
    let updated = context
        .update_profile(&second.id, "first", None, None, None)
        .unwrap();
    assert_eq!(updated.name, "first");
}

#[test]
fn icon_ids_are_validated() {
    assert_eq!(profiles::validated_icon(None).unwrap(), None);
    assert_eq!(profiles::validated_icon(Some("  ")).unwrap(), None);
    assert_eq!(
        profiles::validated_icon(Some(" zhipu "))
            .unwrap()
            .as_deref(),
        Some("zhipu")
    );
    assert!(profiles::validated_icon(Some("Zhipu")).is_err());
    assert!(profiles::validated_icon(Some("a!b")).is_err());
    assert!(profiles::validated_icon(Some(&"x".repeat(41))).is_err());
}

#[test]
fn add_builtin_profile_creates_snapshot_only() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    let original = "model = \"glm-5.3\"\n";
    std::fs::write(paths.codex_config(), original).unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context
        .add_builtin_profile(
            "deepseek",
            Some("https://custom.example"),
            Some("sk-test"),
            None,
            None,
        )
        .unwrap();

    assert_eq!(profile.name, "DeepSeek");
    assert_eq!(profile.model.as_deref(), Some("deepseek-v4-flash"));
    assert_eq!(profile.provider.as_deref(), Some("deepseek"));
    assert_eq!(profile.reasoning_effort.as_deref(), Some("high"));
    assert_eq!(profile.icon.as_deref(), Some("deepseek"));
    assert!(profile.has_key);

    let stored = context.database.profile(&profile.id).unwrap();
    assert_eq!(stored.payload.builtin.as_deref(), Some("deepseek"));
    assert_eq!(
        stored
            .payload
            .model_values
            .get("model_catalog_json")
            .map(|raw| raw.trim().trim_matches('"')),
        Some("~/.codex/models.json")
    );
    assert!(stored
        .payload
        .provider_body
        .as_deref()
        .unwrap()
        .contains("sk-test"));
    assert!(stored
        .payload
        .provider_body
        .as_deref()
        .unwrap()
        .contains("https://custom.example"));

    // 添加只存快照，不写生产配置
    assert_eq!(
        std::fs::read_to_string(context.paths.codex_config()).unwrap(),
        original
    );

    // 同名模板允许重复添加，名字相同，靠 ID 区分
    let duplicate = context
        .add_builtin_profile("deepseek", None, Some("sk-test"), None, None)
        .unwrap();
    assert_eq!(duplicate.name, "DeepSeek");
    assert_ne!(duplicate.id, profile.id);
}

#[test]
fn get_builtin_catalog_returns_embedded_file_content() {
    let home = tempfile::tempdir().unwrap();
    let context = AppContext::new(crate::paths::from_home(home.path()).unwrap()).unwrap();

    assert_eq!(
        context.get_builtin_catalog("deepseek").unwrap(),
        Some(String::from_utf8_lossy(crate::builtin::DEEPSEEK_MODELS).into_owned())
    );
    assert_eq!(
        context.get_builtin_catalog("zhipu").unwrap(),
        Some(String::from_utf8_lossy(crate::builtin::ZHIPU_MODELS).into_owned())
    );
    assert_eq!(
        context.get_builtin_catalog("minimax").unwrap(),
        Some(String::from_utf8_lossy(crate::builtin::MINIMAX_CATALOG).into_owned())
    );
    assert_eq!(context.get_builtin_catalog("chatgpt").unwrap(), None);
    assert!(context.get_builtin_catalog("unknown").is_err());
}

#[tokio::test]
async fn balance_rejects_unsupported_or_keyless() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(paths.codex_config(), "model = \"glm-5.3\"\n").unwrap();
    let context = AppContext::new(paths).unwrap();

    // 不支持余额/用量查询的供应商拒绝
    let zhipu = context
        .add_builtin_profile("zhipu", None, Some("zai-key"), None, None)
        .unwrap();
    let error = context.get_profile_balance(&zhipu.id).await.unwrap_err();
    assert!(error.0.contains("该供应商不支持余额/用量查询"));

    // MiniMax 但只有占位符密钥（未配置真实密钥）拒绝
    let keyless = context
        .add_builtin_profile("minimax", None, None, None, None)
        .unwrap();
    let error = context.get_profile_balance(&keyless.id).await.unwrap_err();
    assert!(error.0.contains("没有配置 API 密钥"));
}

#[test]
fn minimax_remains_converts_remaining_to_used_percent() {
    // statusline.ps1 实测形态：general 条目，remaining_percent 是“剩余”
    let entry = connections::MiniMaxModelRemains {
        model_name: "general".into(),
        current_interval_remaining_percent: Some(85.0),
        current_weekly_remaining_percent: Some(96.0),
        remains_time: Some(8_580_000),          // 2h23m
        weekly_remains_time: Some(507_600_000), // 5d21h
    };
    assert_eq!(
        connections::used_percent(entry.current_interval_remaining_percent),
        Some(15)
    );
    assert_eq!(
        connections::used_percent(entry.current_weekly_remaining_percent),
        Some(4)
    );
    assert_eq!(
        entry
            .remains_time
            .and_then(|ms| connections::format_reset(ms, false))
            .as_deref(),
        Some("2h23m")
    );
    assert_eq!(
        entry
            .weekly_remains_time
            .and_then(|ms| connections::format_reset(ms, true))
            .as_deref(),
        Some("5d21h")
    );

    // 剩余 100% → 用量 0
    let entry = connections::MiniMaxModelRemains {
        model_name: "general".into(),
        current_interval_remaining_percent: Some(100.0),
        current_weekly_remaining_percent: Some(100.0),
        remains_time: Some(60_000),
        weekly_remains_time: None,
    };
    assert_eq!(
        connections::used_percent(entry.current_interval_remaining_percent),
        Some(0)
    );
    assert_eq!(
        entry
            .remains_time
            .and_then(|ms| connections::format_reset(ms, false)),
        None
    );

    // 无百分比数据时返回 None（卡片显示“查询失败”而不是假数字）
    let empty = connections::MiniMaxModelRemains {
        model_name: "general".into(),
        current_interval_remaining_percent: None,
        current_weekly_remaining_percent: None,
        remains_time: None,
        weekly_remains_time: None,
    };
    assert_eq!(
        connections::used_percent(empty.current_interval_remaining_percent),
        None
    );
}

#[test]
fn get_state_tags_active_profile_from_live_config() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(
        paths.codex_config(),
        "model = \"glm-5.3\"\nmodel_provider = \"ZAI\"\nmodel_reasoning_effort = \"high\"\n\n[model_providers.ZAI]\nname = \"ZAI\"\nbase_url = \"https://api.example\"\nexperimental_bearer_token = \"secret\"\n",
    )
    .unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context.capture_profile("ZAI High").unwrap();
    context.apply_profile(&profile.id).unwrap();

    // 数据库快照滞后：DB 里推理强度是 old，live 配置手动改成 medium 并累计新键
    let mut payload = context.database.profile(&profile.id).unwrap().payload;
    payload
        .model_values
        .insert("model_reasoning_effort".into(), "\"old\"".into());
    context
        .database
        .update_profile(&profile.id, "ZAI High", &payload, &now_ms().to_string())
        .unwrap();
    std::fs::write(
        context.paths.codex_config(),
        "model = \"glm-5.3\"\nmodel_provider = \"ZAI\"\nmodel_reasoning_effort = \"medium\"\nmodel_catalog_json = \"zai.json\"\n\n[mcp_servers.keep]\ncommand = \"node\"\n\n[model_providers.ZAI]\nname = \"ZAI\"\nbase_url = \"https://api.example\"\nexperimental_bearer_token = \"secret\"\n",
    )
    .unwrap();

    let state = context.get_state().unwrap();
    assert_eq!(
        state.active_profile_id.as_deref(),
        Some(profile.id.as_str())
    );
    let summary = state
        .profiles
        .iter()
        .find(|item| item.id == profile.id)
        .unwrap();
    assert_eq!(summary.model.as_deref(), Some("glm-5.3"));
    assert_eq!(summary.provider.as_deref(), Some("ZAI"));
    assert_eq!(summary.reasoning_effort.as_deref(), Some("medium"));
    // get_state 按需同步：外部改动已回写进数据库快照
    assert_eq!(
        context
            .database
            .profile(&profile.id)
            .unwrap()
            .payload
            .model_values
            .get("model_reasoning_effort")
            .map(|raw| raw.trim().trim_matches('"')),
        Some("medium")
    );
}

#[test]
fn get_state_and_profile_sync_active_snapshot_from_live() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    let context = AppContext::new(paths).unwrap();
    let write = |text: &str| std::fs::write(context.paths.codex_config(), text).unwrap();

    write(
        r#"
model = "glm-5.3"
model_provider = "ZAI"
model_reasoning_effort = "high"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://api.example"
experimental_bearer_token = "secret"
"#,
    );
    let profile = context.capture_profile("ZAI").unwrap();

    // 外部把 live 换成另一套配置
    write(
        r#"
model = "glm-5.3-pro"
model_provider = "ZAI"
model_reasoning_effort = "max"
model_catalog_json = "zai.json"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://new.example"
experimental_bearer_token = "secret"
"#,
    );

    // 打开编辑页（get_profile）即触发同步：DB 快照跟随 live
    let detail = context.get_profile(&profile.id).unwrap();
    assert_eq!(
        detail
            .model_values
            .get("model")
            .map(|value| value.trim().trim_matches('"')),
        Some("glm-5.3-pro")
    );
    let stored = context.database.profile(&profile.id).unwrap();
    assert_eq!(
        stored
            .payload
            .model_values
            .get("model")
            .map(|value| value.trim().trim_matches('"')),
        Some("glm-5.3-pro")
    );
    assert!(stored
        .payload
        .raw_config
        .as_deref()
        .unwrap()
        .contains("model = \"glm-5.3-pro\""));

    // 再外部改一次，get_state（刷新按钮/窗口激活）也会同步
    write(
        r#"
model = "glm-5.4"
model_provider = "ZAI"
model_reasoning_effort = "low"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://new.example"
experimental_bearer_token = "secret"
"#,
    );
    let state = context.get_state().unwrap();
    let summary = state
        .profiles
        .iter()
        .find(|item| item.id == profile.id)
        .unwrap();
    assert_eq!(summary.model.as_deref(), Some("glm-5.4"));
    let stored = context.database.profile(&profile.id).unwrap();
    assert_eq!(
        stored
            .payload
            .model_values
            .get("model")
            .map(|value| value.trim().trim_matches('"')),
        Some("glm-5.4")
    );
}

#[test]
fn show_balance_toggle_survives_live_sync() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(
        paths.codex_config(),
        "model = \"glm-5.3\"\nmodel_provider = \"ZAI\"\n\n[model_providers.ZAI]\nname = \"ZAI\"\nbase_url = \"https://api.example\"\nexperimental_bearer_token = \"secret\"\n",
    )
    .unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context.capture_profile("ZAI").unwrap();
    assert!(!profile.show_balance); // 默认关闭

    context
        .set_profile_show_balance(&profile.id, false)
        .unwrap();

    // 外部改 live 后触发同步，供应商级开关不能被重置回默认值
    std::fs::write(
        context.paths.codex_config(),
        "model = \"glm-5.4\"\nmodel_provider = \"ZAI\"\nmodel_reasoning_effort = \"low\"\n\n[model_providers.ZAI]\nname = \"ZAI\"\nbase_url = \"https://new.example\"\nexperimental_bearer_token = \"secret\"\n",
    )
    .unwrap();
    let state = context.get_state().unwrap();
    let summary = state
        .profiles
        .iter()
        .find(|item| item.id == profile.id)
        .unwrap();
    assert!(!summary.show_balance);
    let stored = context.database.profile(&profile.id).unwrap();
    assert!(!stored.payload.show_balance);
}

#[test]
fn adding_preset_does_not_activate() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(paths.codex_config(), "model = \"glm-5.3\"\n").unwrap();

    let context = AppContext::new(paths).unwrap();
    // 添加供应商是纯入库动作，绝不激活（只有手动应用/捕获才建立使用中）
    context
        .add_builtin_profile("deepseek", None, Some("sk-test"), None, None)
        .unwrap();
    let state = context.get_state().unwrap();
    assert_eq!(state.active_profile_id, None);
    assert_eq!(state.profiles.len(), 1);
}

#[test]
fn export_and_restore_database_round_trip() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(paths.codex_config(), "model = \"glm-5.3\"\n").unwrap();

    let context = AppContext::new(paths.clone()).unwrap();
    let profile = context.capture_profile("A").unwrap();

    let exported = context.export_database().unwrap();
    assert!(exported.exists());
    let name = exported.file_name().unwrap().to_string_lossy().into_owned();
    assert!(context
        .list_database_backups()
        .unwrap()
        .iter()
        .any(|backup| backup.name == name));

    // 把当前库改乱，再从备份恢复
    context.database.delete_profile(&profile.id).unwrap();
    assert!(context.database.profiles().unwrap().is_empty());
    context.restore_database(&name).unwrap();
    assert_eq!(context.database.profiles().unwrap().len(), 1);

    // 非法文件名拒绝
    assert!(context.restore_database("../evil.db").is_err());
    assert!(context.delete_database_backup("..\\evil.db").is_err());
    assert!(context
        .restore_database("cgswitch-export-nothere.db")
        .is_err());
}

#[test]
fn apply_builtin_profile_writes_exact_config_and_catalog() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(
        paths.codex_config(),
        "model = \"other\"\n[mcp_servers.keep]\ncommand = \"node\"\n",
    )
    .unwrap();
    let old_models = b"{\"models\":[]}";
    std::fs::write(paths.codex_home.join("models.json"), old_models).unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context
        .add_builtin_profile("deepseek", None, Some("sk-test"), None, None)
        .unwrap();
    context.apply_profile(&profile.id).unwrap();

    // 整文件替换，模板之外的键全部清掉，仅密钥占位符被替换；
    // MCP 段例外——跟随 live 携带（全局生效，不随供应商模板丢失）
    let config = std::fs::read(context.paths.codex_config()).unwrap();
    let rendered = crate::builtin::template("deepseek")
        .unwrap()
        .render_config(Some("sk-test"))
        .unwrap();
    let live =
        codex_config::parse_document("model = \"other\"\n[mcp_servers.keep]\ncommand = \"node\"\n")
            .unwrap();
    let expected =
        codex_config::merge_mcp_section(&String::from_utf8_lossy(&rendered), &live).into_bytes();
    assert_eq!(config, expected);
    assert!(!String::from_utf8_lossy(&config).contains("<你的 DeepSeek API Key>"));
    // 关联文件按本供应商字节写入，旧文件已备份
    let models = std::fs::read(context.paths.codex_home.join("models.json")).unwrap();
    assert_eq!(models, crate::builtin::DEEPSEEK_MODELS);
    let backup = std::fs::read_dir(context.paths.codex_files_backup.clone())
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(std::fs::read(backup).unwrap(), old_models);
    assert!(context.paths.config_backup.read_dir().unwrap().count() > 0);
}

fn mcp_test_context(live_config: &str) -> (AppContext, tempfile::TempDir) {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    if !live_config.is_empty() {
        std::fs::write(paths.codex_config(), live_config).unwrap();
    }
    (AppContext::new(paths).unwrap(), home)
}

fn read_config_text(context: &AppContext) -> String {
    String::from_utf8(std::fs::read(context.paths.codex_config()).unwrap()).unwrap()
}

#[test]
fn mcp_save_edit_preserves_unmodeled_keys_and_subtables() {
    let (context, _home) = mcp_test_context(
        r#"[mcp_servers.dev_repl]
command = "node_repl.exe"
args = []
startup_timeout_sec = 120
cwd = "C:\\bin"

# 勿动：桌面版自动维护
[mcp_servers.dev_repl.env]
CODEX_HOME = "C:\\.codex"
"#,
    );

    context
        .save_mcp_server(
            Some("dev_repl"),
            McpServerSpec {
                name: "dev_repl".into(),
                command: Some("node_repl.exe".into()),
                args: vec!["--verbose".into()],
                env: BTreeMap::from([("CODEX_HOME".into(), "C:\\.codex".into())]),
                startup_timeout_sec: Some(120),
                ..Default::default()
            },
        )
        .unwrap();

    let config = read_config_text(&context);
    assert!(config.contains("cwd = \"C:\\\\bin\""), "{config}");
    assert!(config.contains("# 勿动：桌面版自动维护"), "{config}");
    assert!(config.contains("startup_timeout_sec = 120"), "{config}");
    assert!(config.contains("\"--verbose\""), "{config}");
    assert!(context.paths.config_backup.read_dir().unwrap().count() > 0);

    let servers = context.list_mcp_servers().unwrap();
    assert_eq!(servers.len(), 1);
    assert_eq!(servers[0].args, ["--verbose"]);
    assert_eq!(servers[0].startup_timeout_sec, Some(120));
}

#[test]
fn mcp_save_renames_server() {
    let (context, _home) =
        mcp_test_context("[mcp_servers.old]\nurl = \"https://mcp.example/mcp\"\n");

    context
        .save_mcp_server(
            Some("old"),
            McpServerSpec {
                name: "fresh".into(),
                url: Some("https://mcp.example/mcp".into()),
                ..Default::default()
            },
        )
        .unwrap();

    let config = read_config_text(&context);
    assert!(!config.contains("mcp_servers.old"), "{config}");
    assert!(config.contains("mcp_servers.fresh"), "{config}");
}

#[test]
fn mcp_save_rejects_invalid_input() {
    let (context, _home) =
        mcp_test_context("[mcp_servers.tavily]\nurl = \"https://mcp.tavily.com/mcp\"\n");

    let spec = |name: &str, url: Option<&str>, command: Option<&str>| McpServerSpec {
        name: name.into(),
        url: url.map(str::to_string),
        command: command.map(str::to_string),
        ..Default::default()
    };

    // 重名（新建）
    assert!(context
        .save_mcp_server(None, spec("tavily", Some("https://other/mcp"), None))
        .is_err());
    // 非法名称：点号嵌套 / 空格 / 中文 / 空
    assert!(context
        .save_mcp_server(None, spec("a.b", None, Some("node")))
        .is_err());
    assert!(context
        .save_mcp_server(None, spec("a b", None, Some("node")))
        .is_err());
    assert!(context
        .save_mcp_server(None, spec("中文", None, Some("node")))
        .is_err());
    assert!(context
        .save_mcp_server(None, spec("", None, Some("node")))
        .is_err());
    // 传输互斥与必填
    assert!(context
        .save_mcp_server(None, spec("x", Some("https://a/mcp"), Some("node")))
        .is_err());
    assert!(context
        .save_mcp_server(None, spec("x", None, None))
        .is_err());
    assert!(context
        .save_mcp_server(None, spec("x", Some("ftp://a"), None))
        .is_err());
    // 超时为正
    assert!(context
        .save_mcp_server(
            None,
            McpServerSpec {
                name: "x".into(),
                command: Some("node".into()),
                startup_timeout_sec: Some(0),
                ..Default::default()
            }
        )
        .is_err());
}

#[test]
fn mcp_managed_entry_hidden_and_untouchable() {
    // node_repl 由 Codex 桌面版自动写入/更新，本应用完全跳过且不许碰
    let (context, _home) = mcp_test_context(
        "[mcp_servers.node_repl]\ncommand = \"node_repl.exe\"\nargs = []\n\n[mcp_servers.github]\nurl = \"https://x/mcp\"\n",
    );

    // 列表不显示托管条目
    let servers = context.list_mcp_servers().unwrap();
    let names: Vec<&str> = servers.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(names, ["github"]);

    // 正常导入一次保证镜像与 live 一致，再往镜像塞入残留的 node_repl 片段
    context.import_mcp_from_live().unwrap();
    let mut fragments = context.database.mcp_server_fragments().unwrap();
    fragments.push((
        "node_repl".into(),
        "[mcp_servers.node_repl]\ncommand = \"stale.exe\"\n".into(),
    ));
    context
        .database
        .replace_mcp_server_fragments(&fragments, "2")
        .unwrap();

    // 差异对比对两侧的托管条目都视而不见：无差异
    let preview = context.mcp_sync_preview().unwrap();
    assert!(preview.entries.is_empty(), "{:?}", preview.entries.len());

    // 不能以托管名创建/编辑，也不能删除
    assert!(context
        .save_mcp_server(
            None,
            McpServerSpec {
                name: "node_repl".into(),
                command: Some("x".into()),
                ..Default::default()
            }
        )
        .is_err());
    assert!(context.delete_mcp_server("node_repl").is_err());

    // 镜像写回 live：托管条目原样保留（不被 stale 片段覆盖、也不被删除）
    context.restore_mcp_from_database().unwrap();
    let config = read_config_text(&context);
    assert!(config.contains("[mcp_servers.node_repl]"), "{config}");
    assert!(config.contains("node_repl.exe"), "{config}");
    assert!(!config.contains("stale.exe"), "{config}");
    assert!(config.contains("[mcp_servers.github]"), "{config}");
}

#[test]
fn mcp_save_with_fragment_is_wysiwyg() {
    // 片段路径保存：编辑器新增的未建模键/注释保留，片段里删掉的键（cwd）随之消失，
    // 片段缺失的建模字段（url）按 spec 补齐
    let (context, _home) =
        mcp_test_context("[mcp_servers.a]\nurl = \"https://a/mcp\"\ncwd = \"/old\"\n");
    let fragment = "[mcp_servers.a]\n# 手动维护\ntools = [\"x\"]\n";
    context
        .save_mcp_server_with_fragment(
            Some("a"),
            McpServerSpec {
                name: "a".into(),
                url: Some("https://a/mcp".into()),
                ..Default::default()
            },
            Some(fragment),
        )
        .unwrap();

    let config = read_config_text(&context);
    assert!(config.contains("[mcp_servers.a]"), "{config}");
    assert!(config.contains("# 手动维护"), "{config}");
    assert!(config.contains("tools = [\"x\"]"), "{config}");
    assert!(config.contains("url = \"https://a/mcp\""), "{config}");
    assert!(!config.contains("cwd"), "{config}");
}

#[test]
fn mcp_delete_removes_only_target() {
    let (context, _home) = mcp_test_context(
        "[mcp_servers.a]\nurl = \"https://a/mcp\"\n\n[mcp_servers.b]\nurl = \"https://b/mcp\"\n",
    );

    context.delete_mcp_server("a").unwrap();

    let config = read_config_text(&context);
    assert!(!config.contains("mcp_servers.a"), "{config}");
    assert!(config.contains("mcp_servers.b"), "{config}");
    // 不存在的服务器报错（外部并发修改时让用户看见）
    assert!(context.delete_mcp_server("nothere").is_err());
}

#[test]
fn apply_raw_profile_carries_live_mcp_section() {
    let (context, _home) = mcp_test_context(concat!(
        "[mcp_servers.tavily]\nurl = \"https://mcp.tavily.com/mcp\"\n\n",
        "[marketplaces.ponytail]\nsource = \"https://github.com/DietrichGebert/ponytail.git\"\n\n",
        "[plugins.\"ponytail@ponytail\"]\nenabled = true\n\n",
        "[hooks.state]\nponytail = true\n",
    ));
    let raw = concat!(
        "model = \"glm-5.3\"\nmodel_provider = \"ZAI\"\n\n",
        "[mcp_servers.stale]\ncommand = \"old\"\n\n",
        "[marketplaces.stale]\nsource = \"old\"\n\n",
        "[plugins.\"stale@stale\"]\nenabled = true\n\n",
        "[model_providers.ZAI]\nname = \"ZAI\"\nbase_url = \"https://api.z.ai\"\nwire_api = \"responses\"\n",
    );
    let profile = context
        .add_custom_profile("智谱", raw, None, None, None, None, None)
        .unwrap();

    context.apply_profile(&profile.id).unwrap();

    let config = read_config_text(&context);
    // live 的 MCP 段被携带进快照供应商；快照里的陈旧段被替换
    assert!(config.contains("mcp_servers.tavily"), "{config}");
    assert!(!config.contains("mcp_servers.stale"), "{config}");
    assert!(config.contains("marketplaces.ponytail"), "{config}");
    assert!(config.contains("ponytail@ponytail"), "{config}");
    assert!(config.contains("ponytail = true"), "{config}");
    assert!(!config.contains("marketplaces.stale"), "{config}");
    assert!(!config.contains("stale@stale"), "{config}");
    assert!(config.contains("model = \"glm-5.3\""), "{config}");
}

#[test]
fn mcp_list_does_not_write_database_mirror() {
    let (context, _home) = mcp_test_context(concat!(
        "[mcp_servers.github]\n",
        "# 手动维护\n",
        "command = \"node\"\n",
        "cwd = \"/srv\"\n",
    ));

    let servers = context.list_mcp_servers().unwrap();
    assert_eq!(servers.len(), 1);

    assert!(context.database.mcp_server_fragments().unwrap().is_empty());
}

#[test]
fn restore_database_writes_mcp_back_to_live() {
    // 机器 A：显式导入 MCP 镜像后导出备份
    let (source_context, _home_a) =
        mcp_test_context("[mcp_servers.tavily]\nurl = \"https://mcp.tavily.com/mcp\"\n");
    context_with_profile(&source_context);
    source_context.import_mcp_from_live().unwrap();
    let exported = source_context.export_database().unwrap();
    let backup_name = exported.file_name().unwrap().to_string_lossy().into_owned();

    // 机器 B：live 没有 MCP，导入备份后 MCP 写回 live
    let (target_context, _home_b) = mcp_test_context("model = \"gpt-5.6\"\n");
    context_with_profile(&target_context);
    std::fs::copy(
        &exported,
        target_context.paths.database_backup.join(&backup_name),
    )
    .unwrap();
    target_context.restore_database(&backup_name).unwrap();

    let config = read_config_text(&target_context);
    assert!(config.contains("mcp_servers.tavily"), "{config}");
    assert!(config.contains("model = \"gpt-5.6\""), "{config}");
}

fn context_with_profile(context: &AppContext) {
    let raw = "model = \"glm-5.3\"\nmodel_provider = \"ZAI\"\n\n[model_providers.ZAI]\nname = \"ZAI\"\nbase_url = \"https://api.z.ai\"\nwire_api = \"responses\"\n";
    context
        .add_custom_profile("智谱", raw, None, None, None, None, None)
        .unwrap();
}

#[test]
fn created_profiles_snapshot_prefers_database_mcp_mirror() {
    let (context, _home) =
        mcp_test_context("[mcp_servers.mirrored]\nurl = \"https://mirror/mcp\"\n");
    context.import_mcp_from_live().unwrap();
    std::fs::write(
        context.paths.codex_config(),
        "[mcp_servers.live]\nurl = \"https://live/mcp\"\n",
    )
    .unwrap();

    // 自定义供应商：粘贴的配置没有 MCP，保存后快照带上全局段（编辑器打开即见）
    let raw = "model = \"glm-5.3\"\nmodel_provider = \"ZAI\"\n\n[model_providers.ZAI]\nname = \"ZAI\"\nbase_url = \"https://api.z.ai\"\nwire_api = \"responses\"\n";
    let custom = context
        .add_custom_profile("智谱", raw, None, None, None, None, None)
        .unwrap();
    let detail = context.get_profile(&custom.id).unwrap();
    let stored = detail.raw_config.expect("自定义快照应有 raw_config");
    assert!(stored.contains("mcp_servers.mirrored"), "{stored}");
    assert!(!stored.contains("mcp_servers.live"), "{stored}");

    // 内置供应商：快照同样带上全局段
    let builtin = context
        .add_builtin_profile("chatgpt", None, None, None, None)
        .unwrap();
    let detail = context.get_profile(&builtin.id).unwrap();
    let stored = detail.raw_config.expect("内置快照应有 raw_config");
    assert!(stored.contains("mcp_servers.mirrored"), "{stored}");
    assert!(!stored.contains("mcp_servers.live"), "{stored}");
}

#[test]
fn created_profiles_fall_back_to_live_mcp_when_mirror_empty() {
    let (context, _home) =
        mcp_test_context("[mcp_servers.tavily]\nurl = \"https://mcp.tavily.com/mcp\"\n");
    let raw = "model = \"glm-5.3\"\nmodel_provider = \"ZAI\"\n\n[model_providers.ZAI]\nname = \"ZAI\"\nbase_url = \"https://api.z.ai\"\nwire_api = \"responses\"\n";
    let custom = context
        .add_custom_profile("智谱", raw, None, None, None, None, None)
        .unwrap();
    let builtin = context
        .add_builtin_profile("chatgpt", None, None, None, None)
        .unwrap();

    for profile in [custom, builtin] {
        let stored = context
            .get_profile(&profile.id)
            .unwrap()
            .raw_config
            .unwrap();
        assert!(stored.contains("mcp_servers.tavily"), "{stored}");
    }
}

#[test]
fn mcp_delete_via_app_clears_database_mirror() {
    let (context, _home) =
        mcp_test_context("[mcp_servers.tavily]\nurl = \"https://mcp.tavily.com/mcp\"\n");

    // 应用内的删除是明确意图：live 与数据库镜像一起清空
    context.delete_mcp_server("tavily").unwrap();
    assert!(context.database.mcp_server_fragments().unwrap().is_empty());

    // 应用内的保存/删除持续整表对齐镜像。
    context
        .save_mcp_server(
            None,
            McpServerSpec {
                name: "a".into(),
                url: Some("https://a/mcp".into()),
                ..Default::default()
            },
        )
        .unwrap();
    context
        .save_mcp_server(
            None,
            McpServerSpec {
                name: "b".into(),
                url: Some("https://b/mcp".into()),
                ..Default::default()
            },
        )
        .unwrap();
    context.delete_mcp_server("a").unwrap();
    let fragments = context.database.mcp_server_fragments().unwrap();
    assert_eq!(fragments.len(), 1);
    assert_eq!(fragments[0].0, "b");
}

#[test]
fn mcp_import_from_live_forces_mirror() {
    let (context, _home) =
        mcp_test_context("[mcp_servers.tavily]\nurl = \"https://mcp.tavily.com/mcp\"\n");
    context.import_mcp_from_live().unwrap();

    // 外部清空 live 后，显式「从配置导入」让数据库接受空态（放弃保留的镜像）
    std::fs::write(context.paths.codex_config(), "model = \"gpt-5.6\"\n").unwrap();
    let count = context.import_mcp_from_live().unwrap();
    assert_eq!(count, 0);
    assert!(context.database.mcp_server_fragments().unwrap().is_empty());
    assert!(context.restore_mcp_from_database().is_err());
}

#[test]
fn restore_mcp_rebuilds_corrupt_config() {
    let (context, _home) =
        mcp_test_context("[mcp_servers.tavily]\nurl = \"https://mcp.tavily.com/mcp\"\n");
    context.import_mcp_from_live().unwrap();

    // 配置文件彻底损坏（无法解析）：恢复按镜像重建整个文件，原文件已自动备份
    std::fs::write(context.paths.codex_config(), "not [ valid").unwrap();
    let count = context.restore_mcp_from_database().unwrap();
    assert_eq!(count, 1);
    let config = read_config_text(&context);
    assert!(config.contains("mcp_servers.tavily"), "{config}");
    codex_config::parse_document(&config).unwrap();
}

#[test]
fn mcp_list_does_not_absorb_externally_deleted_rows() {
    let (context, _home) = mcp_test_context(
        "[mcp_servers.a]\nurl = \"https://a/mcp\"\n\n[mcp_servers.b]\nurl = \"https://b/mcp\"\n",
    );
    context.import_mcp_from_live().unwrap();

    // 外部（codex mcp remove）删掉 a：列表只读，a 保留为“仅数据库”差异
    std::fs::write(
        context.paths.codex_config(),
        "[mcp_servers.b]\nurl = \"https://b/mcp\"\n",
    )
    .unwrap();
    assert_eq!(context.list_mcp_servers().unwrap().len(), 1);
    assert_eq!(context.database.mcp_server_fragments().unwrap().len(), 2);

    // 显式“以配置文件为准”才收敛：a 从数据库清除，预览归零
    let count = context.import_mcp_from_live().unwrap();
    assert_eq!(count, 1);
    let fragments = context.database.mcp_server_fragments().unwrap();
    assert_eq!(fragments.len(), 1);
    assert_eq!(fragments[0].0, "b");
    let preview = context.mcp_sync_preview().unwrap();
    assert!(preview.entries.is_empty(), "{:?}", preview.entries);
}

#[test]
fn mcp_preview_flags_live_only_db_only_and_changed() {
    let (context, _home) = mcp_test_context("[mcp_servers.a]\nurl = \"https://a/mcp\"\n");
    context.import_mcp_from_live().unwrap();

    // 外部改 a 的 url、新增 b，且不再触发 list：预览应报“内容不同”与“仅配置文件”
    std::fs::write(
        context.paths.codex_config(),
        "[mcp_servers.a]\nurl = \"https://a/v2\"\n\n[mcp_servers.b]\nurl = \"https://b/mcp\"\n",
    )
    .unwrap();
    let preview = context.mcp_sync_preview().unwrap();
    assert_eq!(preview.live_count, 2);
    assert_eq!(preview.db_count, 1);
    assert_eq!(preview.entries.len(), 2, "{:?}", preview.entries);

    let changed = preview
        .entries
        .iter()
        .find(|entry| entry.name == "a")
        .unwrap();
    assert_eq!(changed.kind, McpSyncEntryKind::Changed);
    assert!(!changed.unmodeled_only);
    assert_eq!(changed.changed_fields.len(), 1);
    assert_eq!(changed.changed_fields[0].field, "url");
    assert_eq!(
        changed.changed_fields[0].live,
        serde_json::json!("https://a/v2")
    );
    assert_eq!(
        changed.changed_fields[0].db,
        serde_json::json!("https://a/mcp")
    );

    let live_only = preview
        .entries
        .iter()
        .find(|entry| entry.name == "b")
        .unwrap();
    assert_eq!(live_only.kind, McpSyncEntryKind::LiveOnly);

    // live 整段换成 c：a 变成“仅数据库”
    std::fs::write(
        context.paths.codex_config(),
        "[mcp_servers.c]\nurl = \"https://c/mcp\"\n",
    )
    .unwrap();
    let preview = context.mcp_sync_preview().unwrap();
    let db_only = preview
        .entries
        .iter()
        .find(|entry| entry.name == "a")
        .unwrap();
    assert_eq!(db_only.kind, McpSyncEntryKind::DbOnly);
}

#[test]
fn mcp_preview_marks_comment_only_difference_unmodeled() {
    let (context, _home) = mcp_test_context("[mcp_servers.a]\nurl = \"https://a/mcp\"\n");
    context.import_mcp_from_live().unwrap();

    // 只在条目内加一行注释：建模字段全等，差异标记为“仅格式差异”
    std::fs::write(
        context.paths.codex_config(),
        "[mcp_servers.a]\n# 手动维护\nurl = \"https://a/mcp\"\n",
    )
    .unwrap();
    let preview = context.mcp_sync_preview().unwrap();
    assert_eq!(preview.entries.len(), 1, "{:?}", preview.entries);
    let entry = &preview.entries[0];
    assert_eq!(entry.kind, McpSyncEntryKind::Changed);
    assert!(entry.unmodeled_only);
    assert!(entry.changed_fields.is_empty());
}

#[test]
fn mcp_preview_ignores_blank_line_only_difference() {
    let (context, _home) = mcp_test_context("[mcp_servers.a]\nurl = \"https://a/mcp\"\n");
    context.import_mcp_from_live().unwrap();

    std::fs::write(
        context.paths.codex_config(),
        "[mcp_servers.a]\n\n\nurl = \"https://a/mcp\"\n\n",
    )
    .unwrap();
    let preview = context.mcp_sync_preview().unwrap();
    assert!(preview.entries.is_empty(), "{:?}", preview.entries);
}

#[test]
fn mcp_preview_ignores_legacy_empty_mcp_root_header() {
    let (context, _home) = mcp_test_context("[mcp_servers.a]\nurl = \"https://a/mcp\"\n");
    context
        .database
        .replace_mcp_server_fragments(
            &[(
                "a".into(),
                "[mcp_servers]\n\n[mcp_servers.a]\nurl = \"https://a/mcp\"\n".into(),
            )],
            "1",
        )
        .unwrap();

    let preview = context.mcp_sync_preview().unwrap();
    assert!(preview.entries.is_empty(), "{:?}", preview.entries);
}

#[test]
fn mcp_preview_empty_when_mirror_matches_live() {
    let (context, _home) = mcp_test_context("[mcp_servers.a]\nurl = \"https://a/mcp\"\n");
    context.import_mcp_from_live().unwrap();

    let preview = context.mcp_sync_preview().unwrap();
    assert!(preview.entries.is_empty(), "{:?}", preview.entries);
    assert_eq!(preview.live_count, 1);
    assert_eq!(preview.db_count, 1);
}

#[test]
fn mcp_preview_fails_when_live_unparseable() {
    let (context, _home) = mcp_test_context("[mcp_servers.a]\nurl = \"https://a/mcp\"\n");
    context.import_mcp_from_live().unwrap();

    // live 无法解析：预览报错，前端进入“仅可从数据库恢复”降级模式
    std::fs::write(context.paths.codex_config(), "not [ valid").unwrap();
    assert!(context.mcp_sync_preview().is_err());
}

#[test]
fn mcp_save_consolidates_scattered_live_section() {
    // 复刻 Codex 官方应用写入器留下的散落布局：保存后 mcp 必须收拢为连续块
    let (context, _home) = mcp_test_context(concat!(
        "[plugins.a]\nenabled = true\n\n",
        "[mcp_servers.old]\nurl = \"https://old\"\n\n",
        "[plugins.b]\nenabled = true\n\n",
        "[features]\njs = false\n",
    ));
    context
        .save_mcp_server(
            None,
            McpServerSpec {
                name: "fresh".into(),
                url: Some("https://fresh/mcp".into()),
                ..Default::default()
            },
        )
        .unwrap();

    let config = read_config_text(&context);
    let pos = |needle: &str| {
        config
            .find(needle)
            .unwrap_or_else(|| panic!("缺少 {needle}：\n{config}"))
    };
    // 非 mcp 表保持原相对顺序
    assert!(pos("[plugins.a]") < pos("[plugins.b]"));
    assert!(
        pos("[mcp_servers.old]") < pos("[mcp_servers.fresh]"),
        "{config}"
    );
    // mcp 收拢为连续块：首尾 mcp 之间没有其他表混入
    let mcp_span = &config[pos("[mcp_servers.old]")..pos("[mcp_servers.fresh]")];
    assert!(
        !mcp_span.contains("[plugins.") && !mcp_span.contains("[features]"),
        "{config}"
    );
    // 未建模内容逐字保留
    assert!(config.contains("[plugins.b]"), "{config}");
    assert!(
        codex_config::parse_document(&config).is_ok(),
        "保存并收拢分散 MCP 段后必须保持 config.toml 可解析：\n{config}"
    );
}

#[test]
fn update_builtin_profile_writes_key_back_when_active() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(paths.codex_config(), "model = \"other\"\n").unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context
        .add_builtin_profile("deepseek", None, Some("sk-old"), None, None)
        .unwrap();
    context.apply_profile(&profile.id).unwrap();
    assert_eq!(
        context.get_state().unwrap().active_profile_id.as_deref(),
        Some(profile.id.as_str())
    );

    context
        .update_profile(
            &profile.id,
            "DeepSeek 官方",
            Some("https://api.deepseek.com/"),
            Some("sk-real"),
            None,
        )
        .unwrap();

    // 使用中改密钥：只就地更新供应商段落，模板其余内容保持不变
    let config = String::from_utf8(std::fs::read(context.paths.codex_config()).unwrap()).unwrap();
    assert!(config.contains("model = \"deepseek-v4-flash\""));
    assert!(config.contains("experimental_bearer_token = \"sk-real\""));
    assert!(!config.contains("sk-old"));
    assert!(!config.contains("<你的 DeepSeek API Key>"));

    let detail = context.get_profile(&profile.id).unwrap();
    assert_eq!(detail.api_key.as_deref(), Some("sk-real"));
    // 所见即所得：编辑器直接展示真实密钥
    assert!(detail
        .config_fragment
        .contains(r#"experimental_bearer_token = "sk-real""#));
}

#[test]
fn unused_builtin_edit_save_writes_db_only_without_key_prompt() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    let original = "model = \"other\"\n";
    std::fs::write(paths.codex_config(), original).unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context
        .add_builtin_profile("deepseek", None, Some("sk-test"), None, None)
        .unwrap();

    // 未使用：编辑保存只写库，不要求密钥占位符、不碰 live 配置
    let detail = context.get_profile(&profile.id).unwrap();
    let edited = detail.config_fragment.replace("sk-test", "sk-edited");
    context
        .update_profile(
            &profile.id,
            "DeepSeek",
            Some("https://api.deepseek.com/"),
            Some("sk-edited"),
            None,
        )
        .unwrap();
    let updated = context
        .update_profile_config(&profile.id, &edited, None, None)
        .unwrap();
    assert!(updated.raw_config.as_deref().unwrap().contains("sk-edited"));
    assert_eq!(
        std::fs::read_to_string(context.paths.codex_config()).unwrap(),
        original
    );
}

#[test]
fn keyless_builtin_saves_to_db_but_apply_requires_key() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(paths.codex_config(), "model = \"other\"\n").unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context
        .add_builtin_profile("deepseek", None, None, None, None)
        .unwrap();
    assert!(!profile.has_key);
    let detail = context.get_profile(&profile.id).unwrap();
    assert_eq!(detail.api_key.as_deref(), None);
    assert!(detail.config_fragment.contains("<你的 DeepSeek API Key>"));

    let error = context.apply_profile(&profile.id).unwrap_err();
    assert!(error.0.contains("尚未配置 API 密钥"));
    assert_eq!(
        std::fs::read_to_string(context.paths.codex_config()).unwrap(),
        "model = \"other\"\n"
    );
}

#[test]
fn active_builtin_save_without_placeholder_keeps_edited_text() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(paths.codex_config(), "model = \"other\"\n").unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context
        .add_builtin_profile("deepseek", None, Some("sk-test"), None, None)
        .unwrap();
    context.apply_profile(&profile.id).unwrap();

    // 编辑文本里用户已把占位符改成真实密钥：保存不再报“缺少密钥占位符”
    let edited = r#"
model = "deepseek-v4-flash"
model_provider = "deepseek"
preferred_auth_method = "apikey"
forced_login_method = "api"
model_reasoning_effort = "high"
model_catalog_json = "~/.codex/models.json"

[model_providers.deepseek]
name = "deepseek"
base_url = "https://api.deepseek.com/"
wire_api = "responses"
experimental_bearer_token = "sk-in-editor"
"#;
    context
        .update_profile_config(&profile.id, edited, None, None)
        .unwrap();
    let live = std::fs::read_to_string(context.paths.codex_config()).unwrap();
    assert!(live.contains("sk-in-editor"));
    assert!(!live.contains("<你的 DeepSeek API Key>"));
}

#[test]
fn builtin_catalogs_are_not_mixed() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(paths.codex_config(), "model = \"other\"\n").unwrap();

    let context = AppContext::new(paths).unwrap();
    let deepseek = context
        .add_builtin_profile("deepseek", None, Some("sk-d"), None, None)
        .unwrap();
    std::thread::sleep(std::time::Duration::from_millis(2));
    let zhipu = context
        .add_builtin_profile("zhipu", None, Some("sk-z"), None, None)
        .unwrap();

    context.apply_profile(&deepseek.id).unwrap();
    assert_eq!(
        std::fs::read(context.paths.codex_home.join("models.json")).unwrap(),
        crate::builtin::DEEPSEEK_MODELS
    );

    context.apply_profile(&zhipu.id).unwrap();
    assert_eq!(
        std::fs::read(context.paths.codex_home.join("models.json")).unwrap(),
        crate::builtin::ZHIPU_MODELS
    );
}

#[test]
fn apply_minimax_inserts_catalog_line_and_writes_catalog() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(paths.codex_config(), "model = \"other\"\n").unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context
        .add_builtin_profile("minimax", None, Some("mm-key"), None, None)
        .unwrap();
    context.apply_profile(&profile.id).unwrap();

    let config = std::fs::read(context.paths.codex_config()).unwrap();
    let rendered = crate::builtin::template("minimax")
        .unwrap()
        .render_config(Some("mm-key"))
        .unwrap();
    // 应用经 toml_edit 往返（MCP 段携带路径）：live 无 MCP 时内容不变、仅补行尾换行
    let live = codex_config::parse_document("model = \"other\"\n").unwrap();
    let expected =
        codex_config::merge_mcp_section(&String::from_utf8_lossy(&rendered), &live).into_bytes();
    assert_eq!(config, expected);
    assert!(String::from_utf8_lossy(&config)
        .contains("model_catalog_json = \"~/.codex/model-catalogs/custom-catalog.json\""));
    assert!(!String::from_utf8_lossy(&config).contains("<MINIMAX_API_KEY>"));

    let catalog = std::fs::read(
        context
            .paths
            .codex_home
            .join("model-catalogs")
            .join("custom-catalog.json"),
    )
    .unwrap();
    assert_eq!(catalog, crate::builtin::MINIMAX_CATALOG);
}

#[test]
fn apply_chatgpt_writes_official_default_and_keeps_auth() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(
        paths.codex_config(),
        "model_provider = \"ZAI\"\nmodel = \"glm-5.3\"\n\n[model_providers.ZAI]\nname = \"ZAI\"\nbase_url = \"https://open.bigmodel.cn/api/v1\"\nexperimental_bearer_token = \"old-key\"\n",
    )
    .unwrap();
    std::fs::write(paths.codex_home.join("auth.json"), b"{\"login\":\"kept\"}").unwrap();

    let context = AppContext::new(paths).unwrap();
    let profile = context
        .add_builtin_profile("chatgpt", None, None, None, None)
        .unwrap();
    context.apply_profile(&profile.id).unwrap();

    assert_eq!(
        std::fs::read(context.paths.codex_config()).unwrap(),
        crate::builtin::CHATGPT_CONFIG
    );
    assert_eq!(
        std::fs::read(context.paths.codex_home.join("auth.json")).unwrap(),
        b"{\"login\":\"kept\"}"
    );
    assert!(!context.paths.codex_home.join("models.json").exists());
}

#[test]
fn builtin_placeholder_key_is_not_exposed_as_api_key() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(paths.codex_config(), "model = \"glm-5.3\"\n").unwrap();

    let context = AppContext::new(paths).unwrap();
    // 兼容仍带占位符密钥的旧数据：get_profile 不应把占位符当成密钥回显
    let payload = ProfilePayload {
        builtin: Some("deepseek".into()),
        model_values: [
            ("model".to_string(), "\"deepseek-v4-flash\"".into()),
            ("model_reasoning_effort".to_string(), "\"high\"".into()),
            ("model_catalog_json".to_string(), "\"~/.codex/models.json\"".into()),
        ]
        .into_iter()
        .collect(),
        provider_id: Some("deepseek".into()),
        provider_body: Some(
            "name = \"deepseek\"\nbase_url = \"https://api.deepseek.com/\"\nwire_api = \"responses\"\nexperimental_bearer_token = \"<你的 DeepSeek API Key>\""
                .into(),
        ),
        ..Default::default()
    };
    let summary = context
        .database
        .insert_profile("DeepSeek 旧数据", &payload, &now_ms().to_string())
        .unwrap();

    let detail = context.get_profile(&summary.id).unwrap();
    assert_eq!(detail.api_key, None);
    assert!(detail.config_fragment.contains("<你的 DeepSeek API Key>"));
    let state = context.get_state().unwrap();
    let stored_summary = state
        .profiles
        .iter()
        .find(|item| item.id == summary.id)
        .unwrap();
    assert!(!stored_summary.has_key);
}

#[test]
fn update_profile_config_saves_captured_fragment_as_structured() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(
        paths.codex_config(),
        r#"
model = "glm-5.3"
model_provider = "ZAI"
model_reasoning_effort = "high"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://old.example"
experimental_bearer_token = "secret"
"#,
    )
    .unwrap();
    let context = AppContext::new(paths).unwrap();
    let profile = context.capture_profile("GLM").unwrap();

    let edited = r#"
model = "glm-5.5"
model_provider = "ZAI"
model_reasoning_effort = "medium"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://new.example"
experimental_bearer_token = "new-key"
"#;
    let detail = context
        .update_profile_config(&profile.id, edited, None, None)
        .unwrap();
    assert_eq!(detail.raw_config.as_deref(), Some(edited));
    assert_eq!(
        detail
            .model_values
            .get("model")
            .map(|v| v.trim().trim_matches('"')),
        Some("glm-5.5")
    );
    assert!(detail.config_fragment.contains("https://new.example"));

    context.apply_profile(&profile.id).unwrap();
    let live = std::fs::read_to_string(context.paths.codex_config()).unwrap();
    assert!(live.contains("glm-5.5"));
    assert!(live.contains("https://new.example"));
}

#[test]
fn update_profile_config_follows_edited_provider_and_detaches_builtin() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(
        paths.codex_config(),
        r#"
model = "glm-5.3"
model_provider = "ZAI"

[model_providers.ZAI]
name = "ZAI"
"#,
    )
    .unwrap();
    let context = AppContext::new(paths).unwrap();

    // 捕获档案：model_provider 指向不存在的段 → 宽容保存，段体留空
    let profile = context.capture_profile("GLM").unwrap();
    let saved = context
        .update_profile_config(
            &profile.id,
            "model = \"glm-5.3\"\nmodel_provider = \"ZAI\"\n",
            None,
            None,
        )
        .unwrap();
    assert_eq!(saved.provider.as_deref(), Some("ZAI"));
    assert_eq!(
        context
            .database
            .profile(&profile.id)
            .unwrap()
            .payload
            .provider_body,
        None
    );

    // 捕获档案：供应商名与段一致改名 → 供应商身份跟随配置
    let updated = context
        .update_profile_config(
            &profile.id,
            "model = \"glm-5.3\"\nmodel_provider = \"OTHER\"\n\n[model_providers.OTHER]\nname = \"OTHER\"\n",
            None,
            None,
        )
        .unwrap();
    assert_eq!(updated.provider.as_deref(), Some("OTHER"));
    assert_eq!(
        context
            .database
            .profile(&profile.id)
            .unwrap()
            .payload
            .provider_id
            .as_deref(),
        Some("OTHER")
    );

    // 内置档案：改名后脱离内置模板，按完整快照档案处理
    let builtin = context
        .add_builtin_profile("zhipu", None, Some("sk-test"), None, None)
        .unwrap();
    let updated = context
        .update_profile_config(
            &builtin.id,
            "model = \"glm-5.3\"\nmodel_provider = \"OTHER\"\n\n[model_providers.OTHER]\nname = \"OTHER\"\nbase_url = \"https://api.example\"\nexperimental_bearer_token = \"sk-test\"\n",
            None,
            None,
        )
        .unwrap();
    assert_eq!(updated.provider.as_deref(), Some("OTHER"));
    let stored = context.database.profile(&builtin.id).unwrap();
    assert_eq!(stored.payload.provider_id.as_deref(), Some("OTHER"));
    assert_eq!(stored.payload.builtin, None);
}

#[test]
fn update_profile_config_builtin_raw_applies_with_key_and_catalog() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    let context = AppContext::new(paths).unwrap();
    std::fs::write(context.paths.codex_config(), "model = \"other\"\n").unwrap();
    let profile = context
        .add_builtin_profile("zhipu", None, Some("sk-test"), None, None)
        .unwrap();

    let edited = r#"
model = "glm-5.3"
model_provider = "ZAI"
model_reasoning_effort = "max"
model_catalog_json = "~/.codex/models.json"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://open.bigmodel.cn/api/v1"
experimental_bearer_token = "sk-test"
extra = "edited"
"#;
    let catalog = r#"{"models":[{"id":"glm-5.3","name":"GLM 5.3"}]}"#;
    let detail = context
        .update_profile_config(&profile.id, edited, Some(catalog), None)
        .unwrap();
    assert_eq!(detail.raw_config.as_deref(), Some(edited));

    context.apply_profile(&profile.id).unwrap();
    let live = std::fs::read_to_string(context.paths.codex_config()).unwrap();
    assert!(live.contains("extra = \"edited\""));
    assert!(live.contains(r#"experimental_bearer_token = "sk-test""#));
    assert_eq!(
        std::fs::read_to_string(context.paths.codex_home.join("models.json")).unwrap(),
        catalog
    );
}

#[test]
fn autosync_preserves_profile_edited_catalog() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    let context = AppContext::new(paths).unwrap();
    let write = |text: &str| std::fs::write(context.paths.codex_config(), text).unwrap();

    write(
        r#"
model = "glm-5.3"
model_provider = "ZAI"
model_catalog_json = "zai.json"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://api.example"
"#,
    );
    let profile_a = context.capture_profile("A").unwrap();
    std::thread::sleep(std::time::Duration::from_millis(2));
    write(
        r#"
model = "other-model"
model_provider = "ZAI"
model_catalog_json = "zai.json"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://api.example"
"#,
    );
    let profile_b = context.capture_profile("B").unwrap();

    let detail_a = context.get_profile(&profile_a.id).unwrap();
    let catalog = r#"{"models":[{"id":"edited"}]}"#;
    context
        .update_profile_config(
            &profile_a.id,
            &detail_a.config_fragment,
            Some(catalog),
            None,
        )
        .unwrap();

    context.apply_profile(&profile_b.id).unwrap();
    let stored_a = context.database.profile(&profile_a.id).unwrap();
    assert_eq!(stored_a.payload.raw_catalog.as_deref(), Some(catalog));
}

#[test]
fn update_profile_saves_and_clears_admin_url() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(paths.codex_config(), "model = \"glm-5.3\"\n").unwrap();
    let context = AppContext::new(paths).unwrap();
    let profile = context.capture_profile("GLM").unwrap();

    let summary = context
        .update_profile(
            &profile.id,
            "GLM",
            None,
            None,
            Some("https://console.example.com"),
        )
        .unwrap();
    assert_eq!(
        summary.admin_url.as_deref(),
        Some("https://console.example.com")
    );

    let invalid = context
        .update_profile(&profile.id, "GLM", None, None, Some("console.example.com"))
        .unwrap_err();
    assert!(invalid.0.contains("http"));

    context
        .update_profile(&profile.id, "GLM", None, None, Some(""))
        .unwrap();
    let detail = context.get_profile(&profile.id).unwrap();
    assert_eq!(detail.admin_url, None);
}

#[test]
fn duplicate_profile_copies_payload_with_suffix() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(
        paths.codex_config(),
        r#"
model = "glm-5.3"
model_provider = "ZAI"
model_reasoning_effort = "high"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://api.example"
"#,
    )
    .unwrap();
    let context = AppContext::new(paths).unwrap();
    let profile = context.capture_profile("GLM").unwrap();
    context
        .update_profile(
            &profile.id,
            "GLM",
            None,
            None,
            Some("https://console.example.com"),
        )
        .unwrap();
    context
        .set_profile_icon(&profile.id, Some("zhipu"))
        .unwrap();

    let dup = context.duplicate_profile(&profile.id).unwrap();
    assert_eq!(dup.name, "GLM 副本");
    assert_eq!(
        dup.admin_url.as_deref(),
        Some("https://console.example.com")
    );
    assert_eq!(dup.icon.as_deref(), Some("zhipu"));
    let original = context.database.profile(&profile.id).unwrap();
    let copied = context.database.profile(&dup.id).unwrap();
    assert_eq!(copied.payload, original.payload);

    std::thread::sleep(std::time::Duration::from_millis(2));
    let dup2 = context.duplicate_profile(&profile.id).unwrap();
    assert_eq!(dup2.name, "GLM 副本 2");
}

#[test]
fn duplicate_profile_copies_live_auth_and_account_binding() {
    let home = tempfile::tempdir().unwrap();
    let paths = crate::paths::from_home(home.path()).unwrap();
    paths.ensure().unwrap();
    std::fs::create_dir_all(&paths.codex_home).unwrap();
    std::fs::write(
        paths.codex_config(),
        r#"
model = "glm-5.3"
model_provider = "ZAI"

[model_providers.ZAI]
name = "ZAI"
base_url = "https://api.example"
"#,
    )
    .unwrap();
    std::fs::write(
        paths.codex_home.join("auth.json"),
        r#"{"OPENAI_API_KEY":"sk-live"}"#,
    )
    .unwrap();
    let context = AppContext::new(paths).unwrap();
    // 捕获的第三方供应商是使用中、快照无 auth；复制时应带上当前 live auth.json
    let profile = context.capture_profile("GLM").unwrap();
    assert!(context
        .database
        .profile(&profile.id)
        .unwrap()
        .payload
        .raw_auth
        .is_none());
    let dup = context.duplicate_profile(&profile.id).unwrap();
    assert_eq!(
        context
            .database
            .profile(&dup.id)
            .unwrap()
            .payload
            .raw_auth
            .as_deref(),
        Some(r#"{"OPENAI_API_KEY":"sk-live"}"#)
    );

    // 官方供应商：订阅账号绑定一并复制
    context
        .database
        .upsert_account(&crate::database::StoredAccount {
            id: "acc-1".into(),
            email: Some("a@example.com".into()),
            id_token: None,
            refresh_token: "rt".into(),
            auth_json: None,
            authenticated_at: 1,
        })
        .unwrap();
    let official = context
        .add_builtin_profile("chatgpt", None, None, None, Some("acc-1"))
        .unwrap();
    let dup2 = context.duplicate_profile(&official.id).unwrap();
    assert_eq!(
        context
            .database
            .profile(&dup2.id)
            .unwrap()
            .account_id
            .as_deref(),
        Some("acc-1")
    );
}
