import type { TFunction } from "i18next";

/**
 * 把更新失败的错误转成用户可读提示。
 * 网络层错误统一提示检查代理；其余保留后端原文（原文本身的中文化属 P2）。
 * 译文由调用方注入：本函数是纯函数，不持有 i18n 实例。
 */
export function updateFailureMessage(error: unknown, t: TFunction<"updates">) {
  const message = error instanceof Error ? error.message : String(error);
  if (/request|network|connect|timeout|proxy|dns/i.test(message)) {
    return t("error.proxyHint");
  }
  return message || t("error.checkFailed");
}
