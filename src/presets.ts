// 展示元数据：网格选择时的展示 / provider id 推断 / "测试连通" 按钮可用性判定。
// config.toml 原文由后端 builtin 模板单一来源，模型目录同。
export interface BuiltinPreset {
  kind: string;
  name: string;
  provider: string | null;
  icon: string;
  base_url: string;
  admin_url: string | null;
  model: string;
}

/** 支持余额/用量查询的供应商（以 provider_id 键控）；加供应商时在这里加一行即可 */
export const balanceQueryProviders = new Set(["deepseek", "minimax", "ZAI"]);

/** 文案使用“用量”的供应商；DeepSeek 保持“余额”，ChatGPT 额度单独处理。 */
export const usageQueryProviders = new Set(["minimax", "ZAI"]);

/** 余额/用量胶囊变色（已用 <70% 绿 / 70-89 9、橙 / ≥90% 红；负余额红色） */
export function balanceChipClass(
  usagePercent: number | null,
  failed: boolean,
  totalBalance: string | null = null,
): string {
  if (failed) return "chip-danger";
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

export const builtinPresets: BuiltinPreset[] = [
  { kind: "chatgpt", name: "ChatGPT", provider: null, icon: "openai-chatgpt", base_url: "", admin_url: "https://openai.com/chatgpt/pricing", model: "gpt-5.6" },
  { kind: "deepseek", name: "DeepSeek", provider: "deepseek", icon: "deepseek", base_url: "https://api.deepseek.com/", admin_url: "https://platform.deepseek.com", model: "deepseek-flash" },
  { kind: "minimax", name: "MiniMax CN", provider: "minimax", icon: "minimax", base_url: "https://api.minimaxi.com/v1", admin_url: "https://platform.minimaxi.com", model: "MiniMax-M3" },
  { kind: "zhipu", name: "Zhipu CN", provider: "ZAI", icon: "zhipu", base_url: "https://open.bigmodel.cn/api/v1", admin_url: "https://open.bigmodel.cn", model: "glm-5.3" },
  { kind: "opencode", name: "OpenCode", provider: "opencode-go", icon: "opencode", base_url: "https://opencode.ai/zen/go/v1", admin_url: null, model: "glm-5.2" },
  { kind: "openrouter", name: "OpenRouter", provider: "openrouter", icon: "openrouter", base_url: "https://openrouter.ai/api/v1", admin_url: "https://openrouter.ai/settings/keys", model: "openai/gpt-5.6-sol" },
  { kind: "mimo", name: "小米 MiMo", provider: "mimo", icon: "xiaomi-mimo", base_url: "https://api.xiaomimimo.com/v1", admin_url: "https://platform.xiaomimimo.com/#/console/api-keys", model: "mimo-v2.5-pro" },
  { kind: "kimi", name: "Kimi", provider: "kimi", icon: "kimi", base_url: "https://api.moonshot.cn/v1", admin_url: "https://platform.kimi.com/console/api-keys", model: "kimi-k3" },
  { kind: "qwen", name: "通义千问", provider: "Model_Studio_Token_Plan_Personal", icon: "qwen", base_url: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", admin_url: "https://bailian.console.aliyun.com", model: "qwen3.8-max" },
  { kind: "hunyuan", name: "腾讯混元", provider: "hy3-tokenhub", icon: "hunyuan", base_url: "https://tokenhub.tencentmaas.com/v1", admin_url: "https://console.cloud.tencent.com/tokenhub/apikey", model: "hy3" },
  { kind: "doubao", name: "火山方舟豆包", provider: "volcengine-coding-plan", icon: "volcengine", base_url: "https://ark.cn-beijing.volces.com/api/coding/v3", admin_url: "https://ark.volcengine.com/region:cn-beijing/apikey", model: "ark-code-latest" },
  { kind: "custom", name: "自定义", provider: null, icon: "custom", base_url: "", admin_url: null, model: "自定义" },
];

export function builtinPresetByKind(kind: string): BuiltinPreset | undefined {
  return builtinPresets.find((preset) => preset.kind === kind);
}

/** 哪些内置供应商自带静态模型目录档。models.json 槽位的存在判定统一走这里。 */
export const BUILTINS_WITH_CATALOG: ReadonlySet<string> = new Set([
  "deepseek", "minimax", "zhipu", "opencode", "mimo",
]);

export function builtinHasCatalog(kind: string | null | undefined): boolean {
  return kind != null && BUILTINS_WITH_CATALOG.has(kind);
}
