// 供应商图标注册表：新增供应商只需把 <id>.svg 放进 src/assets/providers/，
// 这里会自动收集并出现在图标选择页（LABELS 缺省回退为文件名）。
const files = import.meta.glob<string>("./assets/providers/*.svg", {
  query: "?url",
  import: "default",
  eager: true,
});

const LABELS: Record<string, string> = {
  "openai-chatgpt": "ChatGPT",
  zhipu: "智谱",
  deepseek: "DeepSeek",
  minimax: "MiniMax",
  opencode: "OpenCode",
};

const THEME_INVERTED_IDS = new Set(["openai-chatgpt", "opencode", "xiaomi-mimo"]);

export interface ProviderIcon {
  id: string;
  label: string;
  url: string;
}

export const providerIcons: ProviderIcon[] = Object.entries(files)
  .map(([path, url]) => {
    const id = path.slice(path.lastIndexOf("/") + 1).replace(/\.svg$/, "");
    return { id, label: LABELS[id] ?? id, url };
  })
  // 自定义图标固定排末尾
  .sort((a, b) =>
    a.id === "custom" ? 1 : b.id === "custom" ? -1 : a.label.localeCompare(b.label, "zh"),
  );

export function providerIconUrl(id: string | null | undefined): string | null {
  return id ? (files[`./assets/providers/${id}.svg`] ?? null) : null;
}

export function providerIconThemeClass(id: string | null | undefined): string {
  return id && THEME_INVERTED_IDS.has(id) ? "dark:invert" : "";
}
