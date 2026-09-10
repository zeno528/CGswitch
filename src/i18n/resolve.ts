import type { LanguageSetting } from "../types";

/** 实际生效的界面语言（设置里的 "system" 已被解析掉）。 */
export type AppLanguage = Exclude<LanguageSetting, "system">;

/**
 * 把设置值与系统语言解析成实际生效的语言。
 * 显式设置优先；"system" 时中文语系 → zh-CN，其余（含取不到系统语言）→ en-US。
 *
 * setting 接收 string 而非 LanguageSetting：该值经 JSON 从 Rust 的 String 字段传来，
 * 运行时不保证落在枚举内，未识别的取值按「跟随系统」处理。
 */
export function resolveLanguage(
  setting: string | undefined,
  navigatorLanguage: string | undefined,
): AppLanguage {
  if (setting === "zh-CN" || setting === "en-US") return setting;
  return (navigatorLanguage ?? "").toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}
