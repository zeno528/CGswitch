import i18next from "i18next";

// 供应商图标注册表：新增供应商只需把 <id>.svg 放进 src/assets/providers/，
// 这里会自动收集并出现在图标选择页（LABELS 缺省回退为文件名）。
const files = import.meta.glob<string>("./assets/providers/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
});

// 品牌名中英一致，保持纯字符串；中文展示名用 getter 延迟走 t()：
// 本模块在 setupI18n 之前加载，且语言切换后需取到新值。
const LABELS: Record<string, string> = {
  "openai-chatgpt": "ChatGPT",
  zhipu: "Zhipu",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  opencode: "OpenCode",
  openrouter: "OpenRouter",
  kimi: "Kimi",
  qwen: "Qwen",
  get hunyuan() { return i18next.t("providerName.hunyuan"); },
  get volcengine() { return i18next.t("providerName.volcengine"); },
};

const THEME_INVERTED_IDS = new Set(["openai-chatgpt", "opencode", "xiaomi-mimo", "openrouter"]);

export interface ProviderIcon {
  id: string;
  label: string;
  url: string;
}

// 每次调用重新解析标签并按当前语言排序：LABELS 里的中文名是 getter，
// 模块加载时（setupI18n 之前）取到的是键名，必须等渲染时再取。
export function providerIcons(): ProviderIcon[] {
  return Object.entries(files)
    .map(([path, url]) => {
      const id = path.slice(path.lastIndexOf("/") + 1).replace(/\.svg$/, "");
      return { id, label: LABELS[id] ?? id, url };
    })
    // 自定义图标固定排末尾
    .sort((a, b) =>
      a.id === "custom" ? 1 : b.id === "custom" ? -1 : a.label.localeCompare(b.label, "zh"),
    );
}

export function providerIconUrl(id: string | null | undefined): string | null {
  return id ? (files[`./assets/providers/${id}.svg`] ?? null) : null;
}

export function providerIconThemeClass(id: string | null | undefined): string {
  return id && THEME_INVERTED_IDS.has(id) ? "dark:invert" : "";
}
