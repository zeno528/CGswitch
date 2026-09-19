// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("AppShell 页面加载策略", () => {
  // 页面级懒加载试过并回退：idle 预热最坏推迟 2s，启动后立刻切页仍会撞骨架闪现。
  // 取舍已定——切页零延迟优先于包体，六个页面与编辑器全部静态进主包。
  // 不要断言 import 语句的字面量：调引号或顺序就误报，而且拦不住真正的回退。
  it("禁止懒加载切页：lazy/Suspense 会造成首次切页骨架闪现", () => {
    expect(source).not.toContain("lazy(");
    expect(source).not.toContain("Suspense");
  });
});
