import type { TFunction } from "i18next";
import type { McpServerSpec } from "./types";

/** 剥掉 TOML 源码形式值的首尾引号与空白。
 *  后端 model_values 存的是 toml_edit 的 Item Display（源码形式），带引号和前导空格，
 *  展示给用户前需要还原成纯值。 */
export function stripTomlQuotes(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").trim();
}

/**
 * MCP 传输方式文案（MCP 列表行与同步差异弹窗共用）：url → HTTP，command → STDIO。
 * 兜底文案随界面语言变化，故由调用方注入 t（纯函数不持有 i18n 实例）。
 */
export function mcpTransportText(
  server: Pick<McpServerSpec, "url" | "command"> | null,
  t: TFunction<"mcp">,
): string {
  if (server?.url) return "HTTP";
  if (server?.command) return "STDIO";
  return t("transport.unknown");
}
