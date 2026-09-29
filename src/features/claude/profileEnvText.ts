/** 完整 settings.json 编辑器 ↔ 表单三托管键的双向同步。 */

/** CGswitch 托管的 env 键：编辑器里可见、与表单双向绑定；应用时由后端写入 settings.json。 */
export const CLAUDE_MANAGED_ENV_KEYS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_MODEL"] as const;

export interface ClaudeEnvFields {
  baseUrl: string;
  authToken: string;
  model: string;
}

/** Claude Code 支持的模型入口；展示元数据仍由全文编辑器保留，不单独做表单项。 */
export const CLAUDE_MODEL_MAPPING_KEYS = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_MODEL",
  "ANTHROPIC_DEFAULT_FABLE_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
  "ANTHROPIC_CUSTOM_MODEL_OPTION",
] as const;

export type ClaudeModelMappingKey = typeof CLAUDE_MODEL_MAPPING_KEYS[number];
export type ClaudeModelMappings = Record<ClaudeModelMappingKey, string>;

/** 只展示会出现在 /model 菜单中的自定义名称；描述和能力仍留在全文编辑器。 */
export const CLAUDE_MODEL_DISPLAY_KEYS = [
  "ANTHROPIC_DEFAULT_FABLE_MODEL_NAME",
  "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME",
  "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME",
  "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME",
] as const;

export type ClaudeModelDisplayKey = typeof CLAUDE_MODEL_DISPLAY_KEYS[number];
export type ClaudeModelDisplayNames = Record<ClaudeModelDisplayKey, string>;

const oneMillionSuffix = /\[1m\]\s*$/i;

export function hasOneMillionModelSuffix(value: string) {
  return oneMillionSuffix.test(value.trim());
}

export function setOneMillionModelSuffix(value: string, enabled: boolean) {
  const base = value.trim().replace(oneMillionSuffix, "");
  return enabled && base ? `${base}[1M]` : base;
}

const MANAGED_KEY_SET = new Set<string>(CLAUDE_MANAGED_ENV_KEYS);

function parseSettingsObject(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 读取 Claude Code env 中的任意字符串字段，供高级开关复用。 */
export function readEnvValue(text: string, key: string) {
  const settings = parseSettingsObject(text);
  const env = settings?.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return "";
  const value = (env as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

/** 只更新一个 Claude Code env 字段，保留 settings.json 其他内容。 */
export function patchEnvValue(text: string, key: string, value: string | null) {
  const settings = parseSettingsObject(text);
  if (!settings) return text;
  const currentEnv = settings.env === undefined ? {} : settings.env;
  if (!currentEnv || typeof currentEnv !== "object" || Array.isArray(currentEnv)) return text;
  const env = { ...currentEnv } as Record<string, unknown>;
  const nextValue = value?.trim() ?? "";
  if (nextValue) env[key] = nextValue;
  else delete env[key];
  if (JSON.stringify(env) === JSON.stringify(currentEnv)) return text;
  return JSON.stringify({ ...settings, env }, null, 2);
}

/** 读取 Claude Code 顶层 Git 归属开关；兼容已弃用的 includeCoAuthoredBy。 */
export function readGitAttributionDisabled(text: string) {
  const settings = parseSettingsObject(text);
  if (!settings) return false;
  const attribution = settings.attribution;
  if (attribution && typeof attribution === "object" && !Array.isArray(attribution)) {
    const values = attribution as Record<string, unknown>;
    return values.commit === "" && values.pr === "";
  }
  return settings.includeCoAuthoredBy === false;
}

/** 用官方 attribution.commit/pr 关闭或恢复 Claude Code 的 Git 归属文本。 */
export function patchGitAttribution(text: string, disabled: boolean) {
  const settings = parseSettingsObject(text);
  if (!settings) return text;
  const current = settings.attribution;
  const attribution = current && typeof current === "object" && !Array.isArray(current)
    ? { ...(current as Record<string, unknown>) }
    : {};
  if (disabled) {
    attribution.commit = "";
    attribution.pr = "";
  } else {
    delete attribution.commit;
    delete attribution.pr;
    delete settings.includeCoAuthoredBy;
  }
  if (Object.keys(attribution).length) settings.attribution = attribution;
  else delete settings.attribution;
  return JSON.stringify(settings, null, 2);
}

function emptyModelMappings(): ClaudeModelMappings {
  return Object.fromEntries(CLAUDE_MODEL_MAPPING_KEYS.map((key) => [key, ""])) as ClaudeModelMappings;
}

function emptyModelDisplayNames(): ClaudeModelDisplayNames {
  return Object.fromEntries(CLAUDE_MODEL_DISPLAY_KEYS.map((key) => [key, ""])) as ClaudeModelDisplayNames;
}

/** 从完整 settings.json 读取 Claude Code 的模型映射字段。 */
export function readModelMappings(text: string): ClaudeModelMappings {
  const settings = parseSettingsObject(text);
  const env = settings?.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return emptyModelMappings();
  const values = env as Record<string, unknown>;
  const mappings = emptyModelMappings();
  for (const key of CLAUDE_MODEL_MAPPING_KEYS) {
    if (typeof values[key] === "string") mappings[key] = values[key];
  }
  return mappings;
}

/** 只更新模型映射字段，保留 settings.json 其他顶层键和 env 键。 */
export function patchModelMappings(text: string, mappings: ClaudeModelMappings): string {
  const settings = parseSettingsObject(text);
  if (!settings) return text;
  const currentEnv = settings.env === undefined ? {} : settings.env;
  if (!currentEnv || typeof currentEnv !== "object" || Array.isArray(currentEnv)) return text;
  const env = { ...currentEnv } as Record<string, unknown>;
  for (const key of CLAUDE_MODEL_MAPPING_KEYS) {
    const value = mappings[key].trim();
    if (value) env[key] = value;
    else delete env[key];
  }
  if (JSON.stringify(env) === JSON.stringify(currentEnv)) return text;
  return JSON.stringify({ ...settings, env }, null, 2);
}

/** 从完整 settings.json 读取模型选择器的显示名称。 */
export function readModelDisplayNames(text: string): ClaudeModelDisplayNames {
  const settings = parseSettingsObject(text);
  const env = settings?.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return emptyModelDisplayNames();
  const values = env as Record<string, unknown>;
  const names = emptyModelDisplayNames();
  for (const key of CLAUDE_MODEL_DISPLAY_KEYS) {
    if (typeof values[key] === "string") names[key] = values[key];
  }
  return names;
}

/** 只更新模型选择器显示名称，保留其他 settings 内容。 */
export function patchModelDisplayNames(text: string, names: ClaudeModelDisplayNames): string {
  const settings = parseSettingsObject(text);
  if (!settings) return text;
  const currentEnv = settings.env === undefined ? {} : settings.env;
  if (!currentEnv || typeof currentEnv !== "object" || Array.isArray(currentEnv)) return text;
  const env = { ...currentEnv } as Record<string, unknown>;
  for (const key of CLAUDE_MODEL_DISPLAY_KEYS) {
    const value = names[key].trim();
    if (value) env[key] = value;
    else delete env[key];
  }
  if (JSON.stringify(env) === JSON.stringify(currentEnv)) return text;
  return JSON.stringify({ ...settings, env }, null, 2);
}

/** 旧配置没有全文时，只能从已保存的 env 字段构造兼容视图。 */
export function buildSettingsText(detail: { raw_settings: string | null; base_url: string | null; auth_token: string | null; model: string | null; extra_env: string | null }): string {
  if (detail.raw_settings !== null) return detail.raw_settings;
  const env: Record<string, unknown> = parseSettingsObject(detail.extra_env ?? "") ?? {};
  const managed: [string, string | null][] = [
    ["ANTHROPIC_BASE_URL", detail.base_url],
    ["ANTHROPIC_AUTH_TOKEN", detail.auth_token],
    ["ANTHROPIC_MODEL", detail.model],
  ];
  for (const [key, value] of managed) {
    if (value) env[key] = value;
    else delete env[key];
  }
  return JSON.stringify({ env }, null, 2);
}

/** 从完整文件的 env 对象读出三个托管键。 */
export function readEnvFields(text: string): ClaudeEnvFields | null {
  const settings = parseSettingsObject(text);
  if (!settings) return null;
  const env = settings.env === undefined ? {} : settings.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return null;
  const fields = env as Record<string, unknown>;
  const value = (key: string) => (typeof fields[key] === "string" ? (fields[key] as string) : "");
  return {
    baseUrl: value("ANTHROPIC_BASE_URL"),
    authToken: value("ANTHROPIC_AUTH_TOKEN"),
    model: value("ANTHROPIC_MODEL"),
  };
}

/** 表单只改完整文件的 env 托管键，其余顶层键原样保留。 */
export function patchEnvFields(text: string, fields: ClaudeEnvFields): string {
  const settings = parseSettingsObject(text);
  if (!settings) return text;
  const currentEnv = settings.env === undefined ? {} : settings.env;
  if (!currentEnv || typeof currentEnv !== "object" || Array.isArray(currentEnv)) return text;
  const env = { ...currentEnv } as Record<string, unknown>;
  const managed: [string, string][] = [
    ["ANTHROPIC_BASE_URL", fields.baseUrl.trim()],
    ["ANTHROPIC_AUTH_TOKEN", fields.authToken.trim()],
    ["ANTHROPIC_MODEL", fields.model.trim()],
  ];
  for (const [key, value] of managed) {
    if (value) env[key] = value;
    else delete env[key];
  }
  if (JSON.stringify(env) === JSON.stringify(currentEnv)) return text;
  return JSON.stringify({ ...settings, env }, null, 2);
}

/** 保存时校验完整文件并拆分 env 附加键。 */
export function splitEnvExtras(text: string): string | null | undefined {
  const settings = parseSettingsObject(text);
  if (!settings) return undefined;
  const env = settings.env === undefined ? {} : settings.env;
  if (!env || typeof env !== "object" || Array.isArray(env)) return undefined;
  if (Object.values(env).some((value) => typeof value !== "string")) return undefined;
  const extras = Object.fromEntries(Object.entries(env).filter(([key]) => !MANAGED_KEY_SET.has(key)));
  return Object.keys(extras).length ? JSON.stringify(extras, null, 2) : null;
}
