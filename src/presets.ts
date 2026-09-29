import i18next from "i18next";

// 展示元数据：网格选择时的展示 / provider id 推断 / "测试连通" 按钮可用性判定。
// config.toml 原文由后端 builtin 模板单一来源，模型目录同。

/** 官方多区域端点档（cn/全球）；region 只用于下拉展示，写入配置的永远是 URL 本身。 */
export interface PresetEndpoint {
  region: "cn" | "global";
  /** 同一区域存在多条计费通道时的档位名（如 Coding Plan / Agent Plan）；缺省时菜单只显示区域徽标。 */
  label?: string;
  base_url: string;
  admin_url: string | null;
}

export interface BuiltinPreset {
  kind: string;
  name: string;
  provider: string | null;
  icon: string;
  base_url: string;
  admin_url: string | null;
  model: string;
  /** 双区域供应商的端点档；首项必须与 base_url/admin_url（默认区域）一致，单区域供应商不带。 */
  endpoints?: readonly PresetEndpoint[];
  /** Anthropic 兼容端点（Claude Code 接入）；有值才会出现在 Claude 预设网格。
   *  名称/图标/控制台地址等身份字段直接沿用本行，不重复维护。 */
  anthropic?: {
    base_url: string;
    /** 双区域 Anthropic 端点档；缺省时 Claude 侧沿用上面的单档。 */
    endpoints?: readonly PresetEndpoint[];
    /** Claude 侧默认模型与本行 model 不同时的覆盖。 */
    model?: string;
  };
}

/** 支持余额/用量查询的供应商（以 provider_id 键控）；加供应商时在这里加一行即可 */
export const balanceQueryProviders = new Set(["deepseek", "minimax", "ZAI"]);

/** 文案使用“用量”的供应商；DeepSeek 保持“余额”，ChatGPT 额度单独处理。 */
export const usageQueryProviders = new Set(["minimax", "ZAI"]);

/** 余额/用量胶囊变色（已用 <70% 绿 / 70-89 9、橙 / ≥90% 红；负余额红色） */
export function balanceChipClass(usagePercent: number | null, totalBalance: string | null = null): string {
  if (usagePercent == null) return Number(totalBalance) < 0 ? "chip-danger" : "chip-success";
  if (usagePercent >= 90) return "chip-danger";
  if (usagePercent >= 70) return "chip-warn";
  return "chip-success";
}

// 地址/密钥留空由表单写入；顶层不带 model 行，模型输入框留空，
// 用户输入或「获取模型列表」选择后经 patchModelValue 插入
export const customConfigTemplate = `model_provider = "custom"
model_reasoning_effort = "high"
disable_response_storage = true
model_catalog_json = "~/.codex/models.json"

[model_providers.custom]
name = "custom"
base_url = ""
wire_api = "responses"
experimental_bearer_token = ""`;

/** 模型目录按 Codex 官方目录的完整字段集（对照 assets/builtin/zhipu-models.json，
 * 每条 21 个字段）：slug 是模型标识；base_instructions 与 supports_reasoning_summaries
 * 为解析器必填字段，缺失会让 Codex 拒载整个目录文件。 */
export const customCatalogTemplate = `{
  "models": [
    {
      "slug": "gpt-5.6-sol",
      "display_name": "GPT 5.6 Sol",
      "description": "GPT 5.6 Sol",
      "default_reasoning_level": "high",
      "supported_reasoning_levels": [
        { "effort": "low", "description": "Light reasoning" },
        { "effort": "high", "description": "Deep reasoning" }
      ],
      "shell_type": "shell_command",
      "visibility": "list",
      "supported_in_api": true,
      "priority": 0,
      "base_instructions": "",
      "supports_reasoning_summaries": true,
      "default_reasoning_summary": "none",
      "support_verbosity": false,
      "apply_patch_tool_type": "freeform",
      "truncation_policy": { "mode": "bytes", "limit": 10000 },
      "context_window": 128000,
      "max_context_window": 128000,
      "effective_context_window_percent": 95,
      "supports_parallel_tool_calls": true,
      "experimental_supported_tools": [],
      "input_modalities": ["text"]
    }
  ]
}`;

// 中文展示名用 getter 延迟走 t()：本模块在 setupI18n 之前加载，且语言切换后需取到新值。
// 品牌名（ChatGPT/DeepSeek 等）中英一致，保持纯字符串。
export const builtinPresets: BuiltinPreset[] = [
  { kind: "custom", get name() { return i18next.t("preset.custom"); }, provider: null, icon: "custom", base_url: "", admin_url: null, model: "自定义" }, // i18n-exempt: 模型名会写入 config.toml，不能随界面语言变化
  { kind: "chatgpt", name: "ChatGPT", provider: null, icon: "openai-chatgpt", base_url: "", admin_url: "https://openai.com/chatgpt/pricing", model: "gpt-5.6" },
  { kind: "deepseek", name: "DeepSeek", provider: "deepseek", icon: "deepseek", base_url: "https://api.deepseek.com/", admin_url: "https://platform.deepseek.com", model: "deepseek-flash", anthropic: { base_url: "https://api.deepseek.com/anthropic", model: "deepseek-v4-pro[1m]" } },
  { kind: "minimax", name: "MiniMax", provider: "minimax", icon: "minimax", base_url: "https://api.minimax.cn/v1", admin_url: "https://platform.minimax.cn", model: "MiniMax-M3", endpoints: [
    { region: "cn", base_url: "https://api.minimax.cn/v1", admin_url: "https://platform.minimax.cn" },
    { region: "global", base_url: "https://api.minimax.io/v1", admin_url: "https://platform.minimax.io" },
  ], anthropic: { base_url: "https://api.minimax.cn/anthropic", endpoints: [
    { region: "cn", base_url: "https://api.minimax.cn/anthropic", admin_url: "https://platform.minimax.cn" },
    { region: "global", base_url: "https://api.minimax.io/anthropic", admin_url: "https://platform.minimax.io" },
  ], model: "MiniMax-M3[1m]" } },
  { kind: "zhipu", get name() { return i18next.t("preset.zhipu"); }, provider: "ZAI", icon: "zhipu", base_url: "https://open.bigmodel.cn/api/v1", admin_url: "https://open.bigmodel.cn", model: "glm-5.3", endpoints: [
    { region: "cn", base_url: "https://open.bigmodel.cn/api/v1", admin_url: "https://open.bigmodel.cn" },
    { region: "global", base_url: "https://api.z.ai/api/v1", admin_url: "https://z.ai/model-api" },
  ], anthropic: { base_url: "https://open.bigmodel.cn/api/anthropic", endpoints: [
    { region: "cn", base_url: "https://open.bigmodel.cn/api/anthropic", admin_url: "https://open.bigmodel.cn" },
    { region: "global", base_url: "https://api.z.ai/api/anthropic", admin_url: "https://z.ai/model-api" },
  ], model: "glm-5.3[1m]" } },
  { kind: "opencode", name: "OpenCode", provider: "opencode-go", icon: "opencode", base_url: "https://opencode.ai/zen/go/v1", admin_url: null, model: "grok-4.6" },
  { kind: "openrouter", name: "OpenRouter", provider: "openrouter", icon: "openrouter", base_url: "https://openrouter.ai/api/v1", admin_url: "https://openrouter.ai/settings/keys", model: "openai/gpt-5.6-sol", anthropic: { base_url: "https://openrouter.ai/api", model: "" } },
  { kind: "mimo", get name() { return i18next.t("preset.mimo"); }, provider: "mimo", icon: "xiaomi-mimo", base_url: "https://api.xiaomimimo.com/v1", admin_url: "https://platform.xiaomimimo.com/#/console/api-keys", model: "mimo-v2.5-pro", anthropic: { base_url: "https://api.xiaomimimo.com/anthropic", endpoints: [
    { region: "cn", base_url: "https://api.xiaomimimo.com/anthropic", admin_url: "https://platform.xiaomimimo.com/#/console/api-keys" },
    { region: "cn", label: "Token Plan", base_url: "https://token-plan-cn.xiaomimimo.com/anthropic", admin_url: "https://platform.xiaomimimo.com/#/console/api-keys" },
  ], model: "mimo-v2.6-pro" } },
  { kind: "kimi", name: "Kimi", provider: "kimi", icon: "kimi", base_url: "https://api.moonshot.cn/v1", admin_url: "https://platform.kimi.com/console/api-keys", model: "kimi-k3", endpoints: [
    { region: "cn", base_url: "https://api.moonshot.cn/v1", admin_url: "https://platform.kimi.com/console/api-keys" },
    { region: "global", base_url: "https://api.moonshot.ai/v1", admin_url: "https://platform.kimi.ai/console/api-keys" },
  ], anthropic: { base_url: "https://api.moonshot.cn/anthropic", endpoints: [
    { region: "cn", base_url: "https://api.moonshot.cn/anthropic", admin_url: "https://platform.kimi.com/console/api-keys" },
    { region: "global", base_url: "https://api.moonshot.ai/anthropic", admin_url: "https://platform.kimi.ai/console/api-keys" },
  ], model: "kimi-k3[1m]" } },
  { kind: "qwen", get name() { return i18next.t("preset.qwen"); }, provider: "Model_Studio_Token_Plan_Personal", icon: "qwen", base_url: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", admin_url: "https://bailian.console.aliyun.com", model: "qwen3.8-max", endpoints: [
    { region: "cn", base_url: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", admin_url: "https://bailian.console.aliyun.com" },
    { region: "global", base_url: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1", admin_url: "https://modelstudio.console.alibabacloud.com/ap-southeast-1" },
  ], anthropic: { base_url: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic", endpoints: [
    { region: "cn", base_url: "https://token-plan.cn-beijing.maas.aliyuncs.com/apps/anthropic", admin_url: "https://bailian.console.aliyun.com" },
    { region: "global", base_url: "https://token-plan.ap-southeast-1.maas.aliyuncs.com/apps/anthropic", admin_url: "https://modelstudio.console.alibabacloud.com/ap-southeast-1" },
  ], model: "" } },
  { kind: "hunyuan", get name() { return i18next.t("preset.hunyuan"); }, provider: "hy3-tokenhub", icon: "hunyuan", base_url: "https://tokenhub.tencentmaas.com/v1", admin_url: "https://console.cloud.tencent.com/tokenhub/apikey", model: "hy3", endpoints: [
    { region: "cn", base_url: "https://tokenhub.tencentmaas.com/v1", admin_url: "https://console.cloud.tencent.com/tokenhub/apikey" },
    { region: "global", base_url: "https://tokenhub-intl.tencentmaas.com/v1", admin_url: null },
  ], anthropic: { base_url: "https://tokenhub.tencentmaas.com", endpoints: [
    { region: "cn", base_url: "https://tokenhub.tencentmaas.com", admin_url: "https://console.cloud.tencent.com/tokenhub/apikey" },
    { region: "global", base_url: "https://tokenhub-intl.tencentmaas.com", admin_url: null },
  ] } },
  // 国内提供 Coding Plan / Agent Plan；海外 BytePlus 仅提供官方确认的 Coding Plan 档。
  // 注意海外域名是 bytepluses.com；/api/v3 不消耗 Coding Plan 额度、按量另计。
  { kind: "doubao", get name() { return i18next.t("preset.doubao"); }, provider: "volcengine-coding-plan", icon: "volcengine", base_url: "https://ark.cn-beijing.volces.com/api/coding/v3", admin_url: "https://ark.volcengine.com/region:cn-beijing/apikey", model: "ark-code-latest", endpoints: [
    { region: "cn", label: "Coding Plan", base_url: "https://ark.cn-beijing.volces.com/api/coding/v3", admin_url: "https://ark.volcengine.com/region:cn-beijing/apikey" },
    { region: "cn", label: "Agent Plan", base_url: "https://ark.cn-beijing.volces.com/api/plan/v3", admin_url: "https://console.volcengine.com/ark/region:cn-beijing/openManagement?advancedActiveKey=agentPlan" },
    { region: "global", label: "Coding Plan", base_url: "https://ark.ap-southeast.bytepluses.com/api/coding/v3", admin_url: "https://ai.byteplus.com/ark/region:ap-southeast-1/apikey" },
  ], anthropic: { base_url: "https://ark.cn-beijing.volces.com/api/coding", model: "ark-code-latest" } },
  { kind: "qianfan", get name() { return i18next.t("preset.qianfan"); }, provider: "qianfan", icon: "baiducloud", base_url: "https://qianfan.baidubce.com/v2", admin_url: "https://console.bce.baidu.com/qianfan/", model: "glm-5.1", anthropic: { base_url: "https://qianfan.baidubce.com/anthropic", model: "deepseek-v3.2" } },
  { kind: "xai", get name() { return i18next.t("preset.xai"); }, provider: "xai", icon: "xai", base_url: "https://api.x.ai/v1", admin_url: "https://console.x.ai/team/default/api-keys", model: "grok-4.7" },
];

export function builtinPresetByKind(kind: string): BuiltinPreset | undefined {
  return builtinPresets.find((preset) => preset.kind === kind);
}

/** Claude Code 供应商预设：从 builtinPresets 派生（带 anthropic 端点的行才进网格），
 *  名称/图标/控制台地址单一来源，只覆盖端点与默认模型；custom 与 Anthropic 官方为固定项。
 *  base_url 是各家 Anthropic 兼容端点，应用时写入 env.ANTHROPIC_BASE_URL。 */
export const claudePresets: BuiltinPreset[] = [
  { kind: "custom", get name() { return i18next.t("preset.custom"); }, provider: null, icon: "custom", base_url: "", admin_url: null, model: "" },
  ...builtinPresets.filter((preset) => preset.anthropic).map((preset) => ({
    ...preset,
    // 重新挂 getter：展开会把延迟取词的 name 快照成加载时的语言，语言切换后不再更新
    get name() { return preset.name; },
    base_url: preset.anthropic!.base_url,
    endpoints: preset.anthropic!.endpoints,
    model: preset.anthropic!.model ?? preset.model,
  })),
  { kind: "anthropic", name: "Anthropic", provider: null, icon: "anthropic", base_url: "https://api.anthropic.com", admin_url: "https://console.anthropic.com/settings/keys", model: "" },
];

export function claudePresetByKind(kind: string | null | undefined): BuiltinPreset | undefined {
  return kind ? claudePresets.find((preset) => preset.kind === kind) : undefined;
}

/** 哪些内置供应商自带静态模型目录档。models.json 槽位的存在判定统一走这里。 */
export const BUILTINS_WITH_CATALOG: ReadonlySet<string> = new Set([
  "deepseek", "minimax", "zhipu", "opencode", "mimo",
]);

export function builtinHasCatalog(kind: string | null | undefined): boolean {
  return kind != null && BUILTINS_WITH_CATALOG.has(kind);
}
