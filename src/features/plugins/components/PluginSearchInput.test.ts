// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PluginSearchInput.tsx", import.meta.url), "utf8");

describe("搜索快捷键", () => {
  it("搜索框支持 Ctrl/Cmd+K 聚焦并全选", () => {
    expect(source).toContain("(event.ctrlKey || event.metaKey)");
    expect(source).toContain('event.key.toLowerCase() === "k"');
    expect(source).toContain("inputRef.current?.focus()");
    expect(source).toContain("inputRef.current?.select()");
  });
});
