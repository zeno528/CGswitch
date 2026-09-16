use super::profile_config::{parse_provider_detail, stored_provider_api_key};
use super::{
    app_err, atomic_write, detect_system_proxy, AppContext, AppResult, AuthSource, BTreeMap,
    PathBuf, ProfileBalanceInfo, ProfileKind,
};
use crate::auth::codex_oauth::{parse_external_auth_json, CodexOAuthManager};

/// 供应商连通性测试结果
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProfileConnectionResult {
    pub ok: bool,
    pub latency_ms: Option<u128>,
    pub status: Option<u16>,
    pub error: Option<String>,
}

/// 供应商余额/用量查询结果
#[derive(Debug, Clone, serde::Serialize)]
pub struct ProfileBalance {
    pub is_available: bool,
    pub balance_infos: Vec<ProfileBalanceInfo>,
    pub latency_ms: Option<u128>,
}

/// DeepSeek 余额接口响应（接口文档：https://api-docs.deepseek.com/zh-cn/api/get-user-balance）
#[derive(Debug, serde::Deserialize)]
struct DeepSeekBalanceResponse {
    is_available: bool,
    balance_infos: Vec<ProfileBalanceInfo>,
}

/// 过滤掉 0 余额币种，有几个非 0 显示几个；全部为 0 时保底返回原列表（CNY 优先）。
fn preferred_deepseek_balance(mut balances: Vec<ProfileBalanceInfo>) -> Vec<ProfileBalanceInfo> {
    if let Some(index) = balances
        .iter()
        .position(|balance| balance.currency == "CNY")
    {
        balances.swap(0, index);
    }
    let non_zero: Vec<ProfileBalanceInfo> = balances
        .iter()
        .filter(|balance| {
            balance
                .total_balance
                .parse::<f64>()
                .is_ok_and(|total| total != 0.0)
        })
        .cloned()
        .collect();
    if non_zero.is_empty() {
        balances
    } else {
        non_zero
    }
}

#[cfg(test)]
mod tests {
    use super::{
        preferred_deepseek_balance, provider_http_error_message, provider_request_error_message,
        quota_failure_error, subscription_http_error_message, subscription_request_error_message,
    };
    use crate::models::ProfileBalanceInfo;

    fn balance(currency: &str, total: &str) -> ProfileBalanceInfo {
        ProfileBalanceInfo {
            currency: currency.into(),
            total_balance: total.into(),
            granted_balance: "0.00".into(),
            topped_up_balance: total.into(),
            usage_percent: None,
            usage_reset: None,
            usage_reset_at: None,
            usage_label: None,
            weekly_usage_percent: None,
            weekly_reset: None,
            weekly_reset_at: None,
            weekly_label: None,
        }
    }

    #[test]
    fn filters_zero_balance_and_prefers_cny_fallback() {
        // USD 为 0 时只显示 CNY。
        let balances = vec![balance("USD", "0.00"), balance("CNY", "8.85")];
        let filtered = preferred_deepseek_balance(balances);
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].currency, "CNY");

        // 两个币种都有余额时都返回，CNY 在前。
        let balances = vec![balance("USD", "5.00"), balance("CNY", "8.85")];
        let filtered = preferred_deepseek_balance(balances);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].currency, "CNY");
        assert_eq!(filtered[1].currency, "USD");

        // 全部为 0 时保底返回原列表，CNY 优先。
        let balances = vec![balance("USD", "0.00"), balance("CNY", "0.00")];
        let filtered = preferred_deepseek_balance(balances);
        assert_eq!(filtered.len(), 2);
        assert_eq!(filtered[0].currency, "CNY");
        assert_eq!(filtered[0].total_balance, "0.00");
    }

    #[test]
    fn provider_connection_errors_use_actionable_messages() {
        assert_eq!(
            provider_http_error_message(reqwest::StatusCode::UNAUTHORIZED),
            "认证失败，请检查 API Key 后重试"
        );
        assert_eq!(
            provider_http_error_message(reqwest::StatusCode::FORBIDDEN),
            "服务商拒绝了请求，请检查后重试"
        );
        assert_eq!(
            provider_http_error_message(reqwest::StatusCode::NOT_FOUND),
            "API 端点不存在或路径不正确，请检查后重试"
        );
        assert_eq!(
            provider_http_error_message(reqwest::StatusCode::BAD_REQUEST),
            "请求未成功，请检查 API 端点、API Key 或网络后重试"
        );

        let error = reqwest::Client::new()
            .get("not a valid URL")
            .build()
            .unwrap_err();
        assert_eq!(
            provider_request_error_message(&error),
            "API 端点格式无效，请检查后重试"
        );
    }

    #[test]
    fn quota_failure_errors_match_relogin_semantics() {
        // 401/403（非地区拦截）→ 登录失效：唯一带重登契约前缀的类别
        let error = quota_failure_error(reqwest::StatusCode::UNAUTHORIZED, "{}", "test");
        assert!(error.0.starts_with("[auth_invalid]"));

        // 地区拦截：换节点可解，不标记为需要重登
        let region = quota_failure_error(
            reqwest::StatusCode::FORBIDDEN,
            r#"{"error":"unsupported_country_region_territory"}"#,
            "test",
        );
        assert!(!region.0.starts_with("[auth_invalid]"));

        // 其他 HTTP 错误按普通失败处理
        let other = quota_failure_error(reqwest::StatusCode::TOO_MANY_REQUESTS, "", "test");
        assert!(other.0.starts_with("额度查询失败："));
    }

    #[test]
    fn subscription_connection_errors_use_subscription_specific_messages() {
        assert_eq!(
            subscription_http_error_message(reqwest::StatusCode::UNAUTHORIZED, ""),
            "ChatGPT 登录已失效，请重新登录"
        );
        assert_eq!(
            subscription_http_error_message(
                reqwest::StatusCode::FORBIDDEN,
                "unsupported_country_region_territory"
            ),
            "ChatGPT 访问受到地区限制，请开启系统代理后重试"
        );
        assert_eq!(
            subscription_http_error_message(reqwest::StatusCode::FORBIDDEN, ""),
            "ChatGPT 订阅请求被拒绝，请重新登录后重试"
        );
        assert_eq!(
            subscription_http_error_message(reqwest::StatusCode::TOO_MANY_REQUESTS, ""),
            "请求过于频繁，请稍后重试"
        );
        assert_eq!(
            subscription_http_error_message(reqwest::StatusCode::BAD_GATEWAY, ""),
            "ChatGPT 订阅服务暂时不可用，请稍后重试"
        );

        let error = reqwest::Client::new()
            .get("not a valid URL")
            .build()
            .unwrap_err();
        assert_eq!(
            subscription_request_error_message(&error),
            "ChatGPT 订阅请求未完成，请稍后重试"
        );
    }
}

/// MiniMax Coding Plan 用量接口响应（国内版：api.minimaxi.com/v1/api/openplatform/coding_plan/remains）
#[derive(Debug, serde::Deserialize)]
struct MiniMaxRemainsResponse {
    #[serde(default)]
    base_resp: MiniMaxBaseResp,
    #[serde(default)]
    model_remains: Vec<MiniMaxModelRemains>,
}

#[derive(Clone, Copy)]
enum BalanceAuth {
    Bearer,
    Raw,
}

struct ZhipuQuotaWindow {
    used_percent: u32,
    reset: Option<String>,
    reset_at: Option<i64>,
    unit: Option<i64>,
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct ChatgptUsageResponse {
    pub(crate) rate_limit: Option<ChatgptRateLimit>,
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct ChatgptRateLimit {
    pub(crate) primary_window: Option<ChatgptRateLimitWindow>,
    pub(crate) secondary_window: Option<ChatgptRateLimitWindow>,
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct ChatgptRateLimitWindow {
    pub(crate) used_percent: Option<f64>,
    pub(crate) limit_window_seconds: Option<i64>,
    pub(crate) reset_at: Option<i64>,
}

#[derive(Debug, Default, serde::Deserialize)]
struct MiniMaxBaseResp {
    #[serde(default)]
    status_code: Option<i64>,
    #[serde(default)]
    status_msg: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct MiniMaxModelRemains {
    #[serde(default)]
    pub(crate) model_name: String,
    /// 剩余百分比（0-100），接口语义为“剩余”，卡片显示“用量”时换算成已用。
    #[serde(default)]
    pub(crate) current_interval_remaining_percent: Option<f64>,
    /// 7 天窗口剩余百分比（0-100）。
    #[serde(default)]
    pub(crate) current_weekly_remaining_percent: Option<f64>,
    /// 5 小时窗口重置倒计时（毫秒）。
    #[serde(default)]
    pub(crate) remains_time: Option<i64>,
    /// 7 天窗口重置倒计时（毫秒）。
    #[serde(default)]
    pub(crate) weekly_remains_time: Option<i64>,
}

/// 统一的 HTTP 客户端：8 秒超时。
/// 出站请求统一入口：显式配置检测到的系统代理并返回代理上下文。
/// reqwest 的隐式系统代理只有它自己知道（只出现在 DEBUG 日志里），
/// 显式配置后「这次请求走了哪个代理」由应用自己掌握，日志才能准确归因。
/// Client 按「检测到的代理地址」缓存复用：代理没变就命中连接池，省掉每次
/// TCP→CONNECT→TLS 全套握手；代理开关/换端口时键变化，自动重建，仍反映当次走向。
/// 缓存条目：键 = 检测到的代理地址，值 = 按它构建的 Client。
type CachedHttpclient = (Option<String>, reqwest::Client);

fn http_client() -> AppResult<(reqwest::Client, Option<String>)> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<Option<CachedHttpclient>>> =
        std::sync::OnceLock::new();
    let cache = CACHE.get_or_init(|| std::sync::Mutex::new(None));
    let mut cached = cache
        .lock()
        .map_err(|_| app_err!("HTTP 客户端缓存锁已损坏"))?;
    let proxy = detect_system_proxy();
    if let Some((key, client)) = cached.as_ref() {
        if *key == proxy {
            return Ok((client.clone(), proxy));
        }
    }
    let mut builder = reqwest::Client::builder().timeout(std::time::Duration::from_secs(8));
    if let Some(url) = &proxy {
        let parsed = reqwest::Proxy::all(url)
            .map_err(|error| app_err!("系统代理地址无效 {url}: {error}"))?;
        builder = builder.proxy(parsed);
    }
    let client = builder
        .build()
        .map_err(|error| app_err!("创建 HTTP 客户端失败: {error}"))?;
    *cached = Some((proxy.clone(), client.clone()));
    Ok((client, proxy))
}

/// 日志归因后缀：括号内原样输出检测结果——有代理是 URL 原文，无代理是 None，不做措辞加工。
pub(crate) fn proxy_note(proxy: &Option<String>) -> String {
    match proxy {
        Some(url) => format!("（proxy={url}）"),
        None => "（proxy=None）".to_string(),
    }
}

/// reqwest 错误转可读提示。
fn reqwest_error_message(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "请求超时".to_string()
    } else if error.is_connect() {
        "连接失败".to_string()
    } else {
        error.to_string()
    }
}

fn provider_http_error_message(status: reqwest::StatusCode) -> &'static str {
    match status {
        reqwest::StatusCode::UNAUTHORIZED => "认证失败，请检查 API Key 后重试",
        reqwest::StatusCode::FORBIDDEN => "服务商拒绝了请求，请检查后重试",
        reqwest::StatusCode::NOT_FOUND => "API 端点不存在或路径不正确，请检查后重试",
        _ => "请求未成功，请检查 API 端点、API Key 或网络后重试",
    }
}

fn provider_request_error_message(error: &reqwest::Error) -> &'static str {
    if error.is_builder() {
        "API 端点格式无效，请检查后重试"
    } else if error.is_timeout() {
        "连接 API 端点超时，请检查后重试"
    } else if error.is_connect() {
        "无法访问 API 端点，请检查后重试"
    } else {
        "请求未成功，请检查 API 端点、API Key 或网络后重试"
    }
}

fn subscription_http_error_message(status: reqwest::StatusCode, body: &str) -> &'static str {
    if body.contains("unsupported_country_region_territory") {
        "ChatGPT 访问受到地区限制，请开启系统代理后重试"
    } else {
        match status {
            reqwest::StatusCode::UNAUTHORIZED => "ChatGPT 登录已失效，请重新登录",
            reqwest::StatusCode::FORBIDDEN => "ChatGPT 订阅请求被拒绝，请重新登录后重试",
            reqwest::StatusCode::TOO_MANY_REQUESTS => "请求过于频繁，请稍后重试",
            status if status.is_server_error() => "ChatGPT 订阅服务暂时不可用，请稍后重试",
            _ => "ChatGPT 订阅请求未完成，请稍后重试",
        }
    }
}

fn subscription_request_error_message(error: &reqwest::Error) -> &'static str {
    if error.is_timeout() {
        "连接 ChatGPT 订阅服务超时，请检查系统代理设置后重试"
    } else if error.is_connect() {
        "无法访问 ChatGPT 订阅服务，请检查系统代理设置后重试"
    } else {
        "ChatGPT 订阅请求未完成，请稍后重试"
    }
}

/// 从 2xx 的 JSON 响应体里识别供应商级错误（OpenAI 风格 `error` 或智谱风格 `code/success`）。
pub(crate) fn connection_error_from_body(value: &serde_json::Value) -> Option<String> {
    if let Some(error) = value.get("error") {
        let message = error
            .get("message")
            .and_then(serde_json::Value::as_str)
            .or_else(|| error.as_str());
        return Some(message.unwrap_or("接口返回错误").to_string());
    }
    if value.get("success").and_then(serde_json::Value::as_bool) == Some(false) {
        let message = value
            .get("msg")
            .and_then(serde_json::Value::as_str)
            .or_else(|| value.get("message").and_then(serde_json::Value::as_str));
        return Some(message.unwrap_or("接口返回错误").to_string());
    }
    if let Some(code) = value.get("code") {
        let is_error_code = match code {
            serde_json::Value::Number(number) => number.as_i64().is_some_and(|n| n >= 400),
            serde_json::Value::String(text) => text.parse::<i64>().is_ok_and(|n| n >= 400),
            _ => false,
        };
        if is_error_code {
            let message = value
                .get("msg")
                .and_then(serde_json::Value::as_str)
                .or_else(|| value.get("message").and_then(serde_json::Value::as_str));
            return Some(message.unwrap_or("接口返回错误").to_string());
        }
    }
    None
}

/// OpenCode Go 的 `/models` 不校验密钥，使用无效参数探针触发鉴权后的请求校验。
async fn test_opencode_connection(
    base_url: &str,
    api_key: &str,
) -> AppResult<ProfileConnectionResult> {
    let responses_url = format!("{}/responses", base_url.trim_end_matches('/'));
    let (client, proxy) = http_client()?;
    let start = std::time::Instant::now();
    let response = client
        .post(&responses_url)
        .bearer_auth(api_key)
        .json(&serde_json::json!({
            "model": "deepseek-v4-flash",
            "input": "ping",
            "max_output_tokens": 0,
        }))
        .send()
        .await;

    match response {
        Ok(response) => {
            let status = response.status();
            let latency_ms = Some(start.elapsed().as_millis());
            let body = response.text().await.unwrap_or_default();
            let probe_validation_rejection =
                matches!(
                    status,
                    reqwest::StatusCode::BAD_REQUEST | reqwest::StatusCode::UNPROCESSABLE_ENTITY
                ) && body.to_ascii_lowercase().contains("max_output_tokens");
            let ok = status.is_success() || probe_validation_rejection;
            let error = (!ok).then(|| provider_http_error_message(status).to_string());
            if ok {
                tauri_plugin_log::log::info!(
                    "[provider] 测试连通成功: HTTP {} - {}ms{}",
                    status.as_u16(),
                    start.elapsed().as_millis(),
                    proxy_note(&proxy)
                );
            }

            Ok(ProfileConnectionResult {
                ok,
                latency_ms,
                status: Some(status.as_u16()),
                error,
            })
        }
        Err(error) => Ok(ProfileConnectionResult {
            ok: false,
            latency_ms: None,
            status: error.status().map(|status| status.as_u16()),
            error: Some(provider_request_error_message(&error).to_string()),
        }),
    }
}

/// 余额/用量请求公共骨架：统一处理鉴权、401/403、错误提取与网络错误；
/// 各家只提供 URL、鉴权方式和成功响应的解析。
async fn query_balance_endpoint(
    client: &reqwest::Client,
    url: &str,
    api_key: &str,
    start: std::time::Instant,
    label: &str,
    auth: BalanceAuth,
    parse: impl FnOnce(String, Option<u128>) -> AppResult<ProfileBalance>,
) -> AppResult<ProfileBalance> {
    let request = client.get(url);
    let response = match auth {
        BalanceAuth::Bearer => request.bearer_auth(api_key).send().await,
        BalanceAuth::Raw => {
            request
                .header("Authorization", api_key)
                .header("Accept-Language", "en-US,en")
                .header("Content-Type", "application/json")
                .send()
                .await
        }
    };
    match response {
        Ok(response) => {
            let status = response.status();
            let latency_ms = Some(start.elapsed().as_millis());
            if status.is_success() {
                let body = response
                    .text()
                    .await
                    .map_err(|error| app_err!("{label}接口响应读取失败: {error}"))?;
                return parse(body, latency_ms);
            }
            if status == reqwest::StatusCode::UNAUTHORIZED
                || status == reqwest::StatusCode::FORBIDDEN
            {
                return Err(app_err!("API Key 无效或无权查询{label}（HTTP {status}）"));
            }
            let message = response
                .json::<serde_json::Value>()
                .await
                .ok()
                .and_then(|value| {
                    value
                        .get("error")
                        .and_then(|error| error.get("message"))
                        .and_then(serde_json::Value::as_str)
                        .map(str::to_string)
                })
                .unwrap_or_else(|| format!("接口返回 HTTP {status}"));
            Err(app_err!("{label}查询失败：{message}"))
        }
        Err(error) => {
            let error_message = reqwest_error_message(&error);
            Err(app_err!("{label}查询失败：{error_message}"))
        }
    }
}

/// DeepSeek 余额查询：GET {base}/user/balance。
async fn query_deepseek_balance(
    client: &reqwest::Client,
    base: &str,
    api_key: &str,
    start: std::time::Instant,
) -> AppResult<ProfileBalance> {
    let url = format!("{}/user/balance", base.trim_end_matches('/'));
    query_balance_endpoint(
        client,
        &url,
        api_key,
        start,
        "余额",
        BalanceAuth::Bearer,
        |body, latency_ms| {
            let parsed = serde_json::from_str::<DeepSeekBalanceResponse>(&body)
                .map_err(|error| app_err!("余额接口响应解析失败: {error}"))?;
            Ok(ProfileBalance {
                is_available: parsed.is_available,
                balance_infos: preferred_deepseek_balance(parsed.balance_infos),
                latency_ms,
            })
        },
    )
    .await
}

/// MiniMax Coding Plan 用量查询：GET {base}/api/openplatform/coding_plan/remains。
/// 接口形态以用户实测可用的 statusline.ps1 为准（国内版 Coding Plan）。
/// 供应商连通性测试核心，与 profile 无关（创建态表单直接复用）。
async fn test_models_endpoint(base_url: &str, api_key: &str) -> AppResult<ProfileConnectionResult> {
    if base_url
        .trim_end_matches('/')
        .eq_ignore_ascii_case("https://opencode.ai/zen/go/v1")
    {
        return test_opencode_connection(base_url, api_key).await;
    }

    let models_url = format!("{}/models", base_url.trim_end_matches('/'));
    let (client, proxy) = http_client()?;

    let start = std::time::Instant::now();
    match client.get(&models_url).bearer_auth(api_key).send().await {
        Ok(response) => {
            let status = response.status();
            let latency_ms = Some(start.elapsed().as_millis());
            if status.is_success() {
                // 部分服务端（如智谱 /api/v1/models）用 HTTP 200 包装认证失败，
                // 只认状态码会把“密钥错误/地址错误”误判成连通成功，必须校验响应体。
                let body = response.text().await.unwrap_or_default();
                match serde_json::from_str::<serde_json::Value>(&body) {
                    Ok(json) => {
                        if let Some(error) = connection_error_from_body(&json) {
                            Ok(ProfileConnectionResult {
                                ok: false,
                                latency_ms,
                                status: Some(status.as_u16()),
                                error: Some(error),
                            })
                        } else {
                            tauri_plugin_log::log::info!(
                                "[provider] 测试连通成功: HTTP {} - {}ms{}",
                                status.as_u16(),
                                start.elapsed().as_millis(),
                                proxy_note(&proxy)
                            );
                            Ok(ProfileConnectionResult {
                                ok: true,
                                latency_ms,
                                status: Some(status.as_u16()),
                                error: None,
                            })
                        }
                    }
                    Err(_) => Ok(ProfileConnectionResult {
                        ok: false,
                        latency_ms,
                        status: Some(status.as_u16()),
                        error: Some(
                            "请求未成功，请检查 API 端点、API Key 或网络后重试".to_string(),
                        ),
                    }),
                }
            } else {
                Ok(ProfileConnectionResult {
                    ok: false,
                    latency_ms,
                    status: Some(status.as_u16()),
                    error: Some(provider_http_error_message(status).to_string()),
                })
            }
        }
        Err(error) => {
            let status = error.status().map(|status| status.as_u16());
            Ok(ProfileConnectionResult {
                ok: false,
                latency_ms: None,
                status,
                error: Some(provider_request_error_message(&error).to_string()),
            })
        }
    }
}

/// 创建态表单的连通性测试：地址/密钥实时传入，无已存 profile 可回退，空值直接报错。
pub async fn test_provider_connection(
    base_url: &str,
    api_key: &str,
) -> AppResult<ProfileConnectionResult> {
    let base_url = base_url.trim();
    if base_url.is_empty() {
        return Err(app_err!("请填写 API 端点"));
    }
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err(app_err!("请填写 API Key"));
    }
    test_models_endpoint(base_url, api_key).await
}

async fn query_minimax_balance(
    client: &reqwest::Client,
    base: &str,
    api_key: &str,
    start: std::time::Instant,
) -> AppResult<ProfileBalance> {
    let url = format!(
        "{}/api/openplatform/coding_plan/remains",
        base.trim_end_matches('/')
    );
    query_balance_endpoint(
        client,
        &url,
        api_key,
        start,
        "用量",
        BalanceAuth::Bearer,
        |body, latency_ms| {
            let parsed = serde_json::from_str::<MiniMaxRemainsResponse>(&body)
                .map_err(|error| app_err!("用量接口响应解析失败: {error}"))?;
            let code = parsed.base_resp.status_code.unwrap_or(-1);
            if code != 0 {
                let message = parsed.base_resp.status_msg.unwrap_or_default();
                return Err(app_err!("用量查询失败：{message}"));
            }
            let entry = parsed
                .model_remains
                .iter()
                .find(|item| item.model_name == "general")
                .or_else(|| parsed.model_remains.first())
                .ok_or_else(|| app_err!("用量查询失败：接口未返回用量数据"))?;
            let usage_percent = used_percent(entry.current_interval_remaining_percent)
                .ok_or_else(|| app_err!("用量查询失败：接口未返回用量数据"))?;
            Ok(ProfileBalance {
                is_available: true,
                balance_infos: vec![ProfileBalanceInfo {
                    currency: String::new(),
                    total_balance: String::new(),
                    granted_balance: String::new(),
                    topped_up_balance: String::new(),
                    usage_percent: Some(usage_percent),
                    usage_reset: entry.remains_time.and_then(|ms| format_reset(ms, false)),
                    usage_reset_at: None,
                    usage_label: None,
                    weekly_usage_percent: used_percent(entry.current_weekly_remaining_percent),
                    weekly_reset: entry
                        .weekly_remains_time
                        .and_then(|ms| format_reset(ms, true)),
                    weekly_reset_at: None,
                    weekly_label: None,
                }],
                latency_ms,
            })
        },
    )
    .await
}

fn zhipu_number(value: &serde_json::Value, key: &str) -> Option<f64> {
    value
        .get(key)
        .and_then(serde_json::Value::as_f64)
        .or_else(|| value.get(key)?.as_str()?.parse().ok())
}

fn zhipu_integer(value: &serde_json::Value, key: &str) -> Option<i64> {
    value
        .get(key)
        .and_then(serde_json::Value::as_i64)
        .or_else(|| value.get(key)?.as_str()?.parse().ok())
}

/// 智谱 GLM Coding Plan 配额响应：TOKENS_LIMIT 包含 5 小时和 7 天窗口。
pub(crate) fn zhipu_quota_info(
    value: &serde_json::Value,
    now_ms: i64,
) -> AppResult<ProfileBalanceInfo> {
    let limits = value
        .get("data")
        .and_then(|data| data.get("limits"))
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| app_err!("用量查询失败：接口未返回限额数据"))?;
    let windows = limits
        .iter()
        .filter(|limit| {
            limit.get("type").and_then(serde_json::Value::as_str) == Some("TOKENS_LIMIT")
        })
        .filter_map(|limit| {
            let used_percent = zhipu_number(limit, "percentage")?.clamp(0.0, 100.0).round() as u32;
            let reset_at = zhipu_integer(limit, "nextResetTime").filter(|value| *value > 0);
            let remaining_ms = reset_at.map(|value| value.saturating_sub(now_ms));
            let unit = zhipu_integer(limit, "unit");
            Some(ZhipuQuotaWindow {
                used_percent,
                reset: remaining_ms
                    .and_then(|ms| format_reset(ms, unit == Some(6) || ms > 86_400_000)),
                reset_at,
                unit,
            })
        })
        .collect::<Vec<_>>();
    let primary = windows
        .iter()
        .find(|window| window.unit == Some(3))
        .ok_or_else(|| app_err!("用量查询失败：接口未返回 5 小时窗口"))?;
    let weekly = windows.iter().find(|window| window.unit == Some(6));

    Ok(ProfileBalanceInfo {
        currency: String::new(),
        total_balance: String::new(),
        granted_balance: String::new(),
        topped_up_balance: String::new(),
        usage_percent: Some(primary.used_percent),
        usage_reset: primary.reset.clone(),
        usage_reset_at: primary.reset_at,
        usage_label: Some("5小时".to_string()),
        weekly_usage_percent: weekly.map(|window| window.used_percent),
        weekly_reset: weekly.and_then(|window| window.reset.clone()),
        weekly_reset_at: weekly.and_then(|window| window.reset_at),
        weekly_label: weekly.map(|_| "7天".to_string()),
    })
}

fn provider_origin(base: &str) -> AppResult<String> {
    let base = base.trim().trim_end_matches('/');
    let authority_start = base
        .find("://")
        .map(|index| index + 3)
        .ok_or_else(|| app_err!("用量查询失败：供应商 API 端点无效"))?;
    let origin_end = base[authority_start..]
        .find('/')
        .map(|index| authority_start + index)
        .unwrap_or(base.len());
    let origin = &base[..origin_end];
    if !origin.starts_with("http://") && !origin.starts_with("https://") {
        return Err(app_err!("用量查询失败：供应商 API 端点无效"));
    }
    Ok(origin.to_string())
}

/// 智谱 GLM Coding Plan 用量查询：GET {origin}/api/monitor/usage/quota/limit。
/// 鉴权值直接使用供应商配置中的 experimental_bearer_token，保持官方插件的请求格式。
async fn query_zhipu_usage(
    client: &reqwest::Client,
    base: &str,
    api_key: &str,
    start: std::time::Instant,
) -> AppResult<ProfileBalance> {
    let url = format!("{}/api/monitor/usage/quota/limit", provider_origin(base)?);
    query_balance_endpoint(
        client,
        &url,
        api_key,
        start,
        "用量",
        BalanceAuth::Raw,
        |body, latency_ms| {
            let value = serde_json::from_str::<serde_json::Value>(&body)
                .map_err(|error| app_err!("用量接口响应解析失败: {error}"))?;
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as i64;
            let info = zhipu_quota_info(&value, now_ms)?;
            Ok(ProfileBalance {
                is_available: true,
                balance_infos: vec![info],
                latency_ms,
            })
        },
    )
    .await
}

/// 接口给的是“剩余”百分比，卡片显示“用量”= 100 - 剩余。
pub(crate) fn used_percent(remaining: Option<f64>) -> Option<u32> {
    let remaining = remaining?;
    let used = 100.0 - remaining;
    Some(used.clamp(0.0, 100.0).round() as u32)
}

/// 重置倒计时格式：按窗口长度决定是否显示天数；不足 1 分钟不显示。
pub(crate) fn format_reset(ms: i64, with_days: bool) -> Option<String> {
    if ms <= 60_000 {
        return None;
    }
    let days = if with_days { ms / 86_400_000 } else { 0 };
    let hours = (ms % 86_400_000) / 3_600_000;
    let minutes = (ms % 3_600_000) / 60_000;
    Some(if days > 0 {
        if hours > 0 {
            format!("{days}d{hours}h")
        } else {
            format!("{days}d")
        }
    } else if hours > 0 {
        if minutes > 0 {
            format!("{hours}h{minutes}m")
        } else {
            format!("{hours}h")
        }
    } else {
        format!("{minutes}m")
    })
}

fn chatgpt_window_label(seconds: Option<i64>, fallback: &str) -> String {
    match seconds {
        Some(18_000) => "5小时".to_string(),
        Some(604_800) => "7天".to_string(),
        Some(2_592_000) => "30天".to_string(),
        Some(value) if value > 0 && value % 86_400 == 0 => format!("{}天", value / 86_400),
        Some(value) if value > 0 && value % 3_600 == 0 => format!("{}小时", value / 3_600),
        _ => fallback.to_string(),
    }
}

fn chatgpt_reset_countdown(reset_at: Option<i64>, window_seconds: Option<i64>) -> Option<String> {
    let reset_ms = chatgpt_reset_timestamp(reset_at)?;
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64;
    format_reset(
        reset_ms.saturating_sub(now_ms),
        window_seconds.unwrap_or_default() >= 86_400,
    )
}

fn chatgpt_reset_timestamp(reset_at: Option<i64>) -> Option<i64> {
    let reset_at = reset_at?;
    Some(if reset_at > 1_000_000_000_000 {
        reset_at
    } else {
        reset_at.saturating_mul(1_000)
    })
}

pub(crate) fn chatgpt_quota_info(response: ChatgptUsageResponse) -> Option<ProfileBalanceInfo> {
    let rate_limit = response.rate_limit?;
    let windows = [rate_limit.primary_window, rate_limit.secondary_window];
    let mut usable_windows = windows
        .iter()
        .flatten()
        .filter(|window| window.used_percent.is_some());
    let primary = usable_windows.next()?;
    let secondary = usable_windows.next();
    let usage_percent = primary.used_percent?.clamp(0.0, 100.0).round() as u32;
    Some(ProfileBalanceInfo {
        currency: String::new(),
        total_balance: String::new(),
        granted_balance: String::new(),
        topped_up_balance: String::new(),
        usage_percent: Some(usage_percent),
        usage_reset: chatgpt_reset_countdown(primary.reset_at, primary.limit_window_seconds),
        usage_reset_at: chatgpt_reset_timestamp(primary.reset_at),
        usage_label: primary
            .limit_window_seconds
            .map(|seconds| chatgpt_window_label(Some(seconds), "额度")),
        weekly_usage_percent: secondary
            .as_ref()
            .and_then(|window| window.used_percent)
            .map(|used| used.clamp(0.0, 100.0).round() as u32),
        weekly_reset: secondary.as_ref().and_then(|window| {
            chatgpt_reset_countdown(window.reset_at, window.limit_window_seconds)
        }),
        weekly_reset_at: secondary
            .as_ref()
            .and_then(|window| chatgpt_reset_timestamp(window.reset_at)),
        weekly_label: secondary.as_ref().and_then(|window| {
            window
                .limit_window_seconds
                .map(|seconds| chatgpt_window_label(Some(seconds), "周期"))
        }),
    })
}

fn chatgpt_usage_request(
    client: &reqwest::Client,
    access_token: &str,
    account_id: Option<&str>,
) -> reqwest::RequestBuilder {
    let mut request = client
        .get("https://chatgpt.com/backend-api/wham/usage")
        .bearer_auth(access_token)
        .header("User-Agent", "codex-cli")
        .header("Accept", "application/json");
    if let Some(account_id) = account_id.filter(|id| *id != "codex-external") {
        request = request.header("chatgpt-account-id", account_id);
    }
    request
}

/// 前后端契约：带此前缀的余额错误表示「登录已失效」，前端把余额卡片切换成
/// 重登入口而不是普通「查询失败」。AppError 是纯字符串，只能靠前缀携带语义。
const AUTH_INVALID_ERROR_PREFIX: &str = "[auth_invalid]";

fn quota_failure_error(
    status: reqwest::StatusCode,
    body: &str,
    context: &str,
) -> crate::error::AppError {
    let auth_status =
        status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN;
    if auth_status && body.contains("unsupported_country_region_territory") {
        tauri_plugin_log::log::warn!(
            "[chatgpt] 额度查询被地区限制拦截 [{context}] (HTTP {status})"
        );
        return app_err!("认证请求被地区限制拦截，请开启系统代理后重试");
    }
    if auth_status {
        tauri_plugin_log::log::warn!(
            "[chatgpt] 额度查询返回 HTTP {status} [{context}]：登录凭证已失效，需要重新登录"
        );
        return app_err!("{AUTH_INVALID_ERROR_PREFIX} ChatGPT 登录已失效，请重新登录");
    }
    tauri_plugin_log::log::warn!("[chatgpt] 额度查询失败 [{context}]: HTTP {status}");
    app_err!("额度查询失败：接口返回 HTTP {status}")
}

async fn query_chatgpt_quota(
    access_token: &str,
    account_id: Option<&str>,
    context: &str,
) -> AppResult<ProfileBalance> {
    let (client, proxy) = http_client().map_err(|error| {
        tauri_plugin_log::log::warn!("[chatgpt] 额度查询客户端初始化失败 [{context}]: {error}");
        error
    })?;
    let start = std::time::Instant::now();
    let response = chatgpt_usage_request(&client, access_token, account_id)
        .send()
        .await
        .map_err(|error| {
            // ChatGPT 订阅链路是唯一没有标准错误码可依赖的路径，失败必须留痕
            tauri_plugin_log::log::warn!(
                "[chatgpt] 额度查询网络错误 [{context}]: {}{}",
                reqwest_error_message(&error),
                proxy_note(&proxy)
            );
            app_err!("额度查询失败：{}", reqwest_error_message(&error))
        })?;
    let latency = start.elapsed().as_millis();
    let latency_ms = Some(latency);
    let status = response.status();
    let body = response.text().await.map_err(|error| {
        tauri_plugin_log::log::warn!("[chatgpt] 额度接口响应读取失败 [{context}]: {error}");
        app_err!("额度接口响应读取失败: {error}")
    })?;
    if !status.is_success() {
        return Err(quota_failure_error(status, &body, context));
    }
    let response = serde_json::from_str::<ChatgptUsageResponse>(&body).map_err(|error| {
        tauri_plugin_log::log::warn!("[chatgpt] 额度接口响应解析失败 [{context}]: {error}");
        app_err!("额度接口响应解析失败: {error}")
    })?;
    let info = chatgpt_quota_info(response).ok_or_else(|| {
        tauri_plugin_log::log::warn!("[chatgpt] 额度查询响应缺少可用的限额窗口 [{context}]");
        app_err!("额度接口未返回可用的限额窗口")
    })?;
    // 成功也留痕：额度数字不对/没刷新时，靠这行确认最后一次成功查询的时间
    tauri_plugin_log::log::info!(
        "[chatgpt] 额度查询成功 [{context}]: HTTP {} - {latency}ms{}",
        status.as_u16(),
        proxy_note(&proxy)
    );
    Ok(ProfileBalance {
        is_available: true,
        balance_infos: vec![info],
        latency_ms,
    })
}

impl AppContext {
    /// 验证供应商密钥连通性：默认请求 OpenAI 兼容的 GET {base}/models，OpenCode Go 使用鉴权探针，
    /// 2xx 视为可用，401/403 视为密钥无效，返回延迟 / HTTP 状态 / 错误信息。
    /// 表单传入的地址/密钥实时生效（传了就用传的，空的直接报错）；
    /// 不传才回退已保存值（卡片上的测试按钮走这条）。
    pub async fn test_profile_connection(
        &self,
        id: &str,
        base_url_override: Option<&str>,
        api_key_override: Option<&str>,
    ) -> AppResult<ProfileConnectionResult> {
        let stored = self.database.profile(id)?;
        let payload = &stored.payload;
        if payload.provider_id.is_none() {
            return Err(app_err!("该供应商缺少配置，无法测试连通性"));
        }
        let body = payload
            .provider_body
            .as_deref()
            .ok_or_else(|| app_err!("该供应商缺少配置数据"))?;
        let detail = parse_provider_detail(body)?;
        let base_url = match base_url_override {
            Some(value) => {
                let value = value.trim();
                if value.is_empty() {
                    return Err(app_err!("请填写 API 端点"));
                }
                value.to_string()
            }
            None => detail
                .base_url
                .filter(|value| !value.trim().is_empty())
                .ok_or_else(|| app_err!("该供应商没有配置 API 端点"))?,
        };
        let api_key = match api_key_override {
            Some(value) => {
                let value = value.trim();
                if value.is_empty() {
                    return Err(app_err!("请填写 API Key"));
                }
                value.to_string()
            }
            None => stored_provider_api_key(payload)
                .ok_or_else(|| app_err!("该供应商没有配置 API Key，请先填写后再测试"))?,
        };

        test_models_endpoint(&base_url, &api_key).await
    }

    /// 验证 ChatGPT 订阅认证连通性：用当前 access_token 请求 Codex 官方后端用量端点
    /// （Codex CLI 后台轮询同一个端点）。2xx 可用；非 2xx 和网络错误按订阅链路分类提示。
    /// 仅手动点击测试时调用，不参与切换流程。
    pub async fn test_subscription_connection(
        &self,
        access_token: &str,
        context: &str,
    ) -> AppResult<ProfileConnectionResult> {
        let (client, proxy) = http_client().map_err(|error| {
            tauri_plugin_log::log::warn!("[chatgpt] 测试连通客户端初始化失败 [{context}]: {error}");
            error
        })?;
        let start = std::time::Instant::now();
        match chatgpt_usage_request(&client, access_token, None)
            .send()
            .await
        {
            Ok(response) => {
                let status = response.status();
                let latency_ms = start.elapsed().as_millis();
                if status.is_success() {
                    // 成功也留痕：延迟数据只存在于弹窗，事后无从追溯
                    tauri_plugin_log::log::info!(
                        "[chatgpt] 测试连通成功 [{context}]: HTTP {} - {latency_ms}ms{}",
                        status.as_u16(),
                        proxy_note(&proxy)
                    );
                    Ok(ProfileConnectionResult {
                        ok: true,
                        latency_ms: Some(latency_ms),
                        status: Some(status.as_u16()),
                        error: None,
                    })
                } else {
                    let text = if status == reqwest::StatusCode::UNAUTHORIZED
                        || status == reqwest::StatusCode::FORBIDDEN
                    {
                        match response.text().await {
                            Ok(text) => text,
                            Err(error) => {
                                tauri_plugin_log::log::warn!(
                                    "[chatgpt] 测试连通响应读取失败 [{context}] HTTP {}: {error}",
                                    status.as_u16()
                                );
                                String::new()
                            }
                        }
                    } else {
                        String::new()
                    };
                    let message = subscription_http_error_message(status, &text);
                    // 测试连通的失败只以返回值形式存在（不是 Err），弹窗错过就无迹可寻
                    tauri_plugin_log::log::warn!(
                        "[chatgpt] 测试连通失败 [{context}]: HTTP {} - {}{}",
                        status.as_u16(),
                        message,
                        proxy_note(&proxy)
                    );
                    Ok(ProfileConnectionResult {
                        ok: false,
                        latency_ms: Some(latency_ms),
                        status: Some(status.as_u16()),
                        error: Some(message.to_string()),
                    })
                }
            }
            Err(error) => {
                let status = error.status().map(|status| status.as_u16());
                tauri_plugin_log::log::warn!(
                    "[chatgpt] 测试连通网络错误 [{context}]: {}{}",
                    subscription_request_error_message(&error),
                    proxy_note(&proxy)
                );
                Ok(ProfileConnectionResult {
                    ok: false,
                    latency_ms: None,
                    status,
                    error: Some(subscription_request_error_message(&error).to_string()),
                })
            }
        }
    }

    /// 读取设置页中的 Codex 登录或指定 OAuth 账号的官方额度。
    pub async fn get_auth_quota(
        &self,
        source: AuthSource,
        account_id: Option<&str>,
        oauth: &CodexOAuthManager,
    ) -> AppResult<ProfileBalance> {
        let (access_token, account_id) = match source {
            AuthSource::Desktop => {
                let account = self
                    .external_codex_auth()?
                    .ok_or_else(|| app_err!("未检测到有效的 Codex 登录"))?;
                let token = self
                    .external_codex_access_token_for_account(&account.id)?
                    .ok_or_else(|| app_err!("未检测到有效的 Codex 登录"))?;
                (token, Some(account.id))
            }
            AuthSource::Oauth => {
                let account_id = account_id.ok_or_else(|| app_err!("OAuth 账号不存在"))?;
                let token = oauth
                    .get_valid_token_for_account(account_id)
                    .await
                    .map_err(|error| app_err!("{error}"))?;
                // chatgpt-account-id 头必须是 workspace ID，本地行 id 不能出站
                (token, Some(oauth.workspace_of(account_id).await))
            }
        };
        let context = account_id
            .as_deref()
            .map(|id| format!("account={id}"))
            .unwrap_or_else(|| "source=desktop".to_string());
        query_chatgpt_quota(&access_token, account_id.as_deref(), &context).await
    }

    /// 按配置查询余额/用量；ChatGPT 配置只读自身认证来源，不读取 live auth.json。
    pub async fn get_profile_balance(
        &self,
        id: &str,
        oauth: &CodexOAuthManager,
    ) -> AppResult<ProfileBalance> {
        let stored = self.database.profile(id)?;
        let payload = &stored.payload;
        if stored.kind == ProfileKind::Official {
            let context = format!("profile={id}");
            let (access_token, account_id) =
                match payload.effective_auth_source(stored.kind, stored.account_id.as_deref()) {
                    Some(AuthSource::Desktop) => payload
                        .raw_auth
                        .as_deref()
                        .and_then(parse_external_auth_json)
                        .map(|auth| (auth.access_token, Some(auth.account_id)))
                        .ok_or_else(|| app_err!("该 Codex 配置尚未保存有效登录"))?,
                    Some(AuthSource::Oauth) => {
                        let account_id = stored
                            .account_id
                            .as_deref()
                            .ok_or_else(|| app_err!("OAuth 配置未绑定订阅账号"))?;
                        let token = oauth
                            .get_valid_token_for_account(account_id)
                            .await
                            .map_err(|error| app_err!("{error}"))?;
                        // chatgpt-account-id 头必须是 workspace ID，本地行 id 不能出站
                        (token, Some(oauth.workspace_of(account_id).await))
                    }
                    None => return Err(app_err!("官方配置缺少登录方式")),
                };
            return query_chatgpt_quota(&access_token, account_id.as_deref(), &context).await;
        }
        let provider = payload.provider_id.as_deref().unwrap_or_default();
        if provider != "deepseek" && provider != "minimax" && provider != "ZAI" {
            return Err(app_err!("该供应商不支持余额/用量查询"));
        }
        let body = payload
            .provider_body
            .as_deref()
            .ok_or_else(|| app_err!("该供应商缺少配置数据"))?;
        let detail = parse_provider_detail(body)?;
        let api_key = stored_provider_api_key(payload)
            .ok_or_else(|| app_err!("该供应商没有配置 API Key，无法查询余额/用量"))?;
        let (client, _proxy) = http_client()?;
        let start = std::time::Instant::now();
        let base = detail
            .base_url
            .as_deref()
            .filter(|value| !value.trim().is_empty());
        match provider {
            "deepseek" => {
                query_deepseek_balance(
                    &client,
                    base.unwrap_or("https://api.deepseek.com"),
                    &api_key,
                    start,
                )
                .await
            }
            "minimax" => {
                query_minimax_balance(
                    &client,
                    base.unwrap_or("https://api.minimaxi.com/v1"),
                    &api_key,
                    start,
                )
                .await
            }
            "ZAI" => {
                query_zhipu_usage(
                    &client,
                    base.unwrap_or("https://open.bigmodel.cn/api/v1"),
                    &api_key,
                    start,
                )
                .await
            }
            _ => unreachable!(),
        }
    }

    /// 供应商级余额缓存：上次成功查询结果写入 ~/.cgswitch/balance-cache.json，
    /// 保证卡片首次渲染/切换视图时数字就在，不出现“消失→出现”的闪烁。
    pub fn set_profile_balance(
        &self,
        profile_id: &str,
        info: &ProfileBalanceInfo,
    ) -> AppResult<()> {
        let mut cache = self.load_balance_cache();
        cache.insert(profile_id.to_string(), info.clone());
        self.save_balance_cache(&cache)
    }

    pub(super) fn balance_cache_path(&self) -> PathBuf {
        self.paths.root.join("balance-cache.json")
    }

    pub(super) fn load_balance_cache(&self) -> BTreeMap<String, ProfileBalanceInfo> {
        std::fs::read_to_string(self.balance_cache_path())
            .ok()
            .and_then(|text| serde_json::from_str(&text).ok())
            .unwrap_or_default()
    }

    pub(super) fn save_balance_cache(
        &self,
        cache: &BTreeMap<String, ProfileBalanceInfo>,
    ) -> AppResult<()> {
        let text = serde_json::to_string(cache)
            .map_err(|error| app_err!("余额缓存序列化失败: {error}"))?;
        atomic_write(&self.balance_cache_path(), text.as_bytes())
    }
}
