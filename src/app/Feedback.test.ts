// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeToastMessage } from "./Feedback";

const source = readFileSync(new URL("./Feedback.tsx", import.meta.url), "utf8");

describe("normalizeToastMessage", () => {
  it("removes duplicated connection-failure prefixes", () => {
    expect(normalizeToastMessage("「供应商」连接失败：连接失败：浏览器跨域限制")).toBe("「供应商」连接失败：浏览器跨域限制");
    expect(normalizeToastMessage("Error: 连接失败：连接失败")).toBe("连接失败");
  });
});

describe("Feedback context value 稳定性", () => {
  it("context value 必须经 useMemo 稳定，只依赖 showToast/confirm", () => {
    // toast 出现/消失只动 toasts state：若 value 每次渲染都是新对象，任何 toast 都会
    // 改变 useFeedback() 的身份，把依赖它的加载 effect（如 ClaudeMcpEdit 拉取已存 JSON）
    // 全部重跑、覆盖用户未保存的草稿。项目无 DOM 渲染基建，这里锁源码契约。
    expect(source).toContain("useMemo<FeedbackContextValue>");
    expect(source).toContain("}), [showToast, confirm]);");
  });
});
