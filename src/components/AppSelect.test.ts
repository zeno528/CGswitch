// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

describe("AppSelect styles", () => {
  it("三类控件共用侧边栏的悬停和激活高亮", () => {
    const sharedStateSource = styleSource.slice(
      styleSource.indexOf(".app-selection-state {"),
      styleSource.indexOf(".apple-sidebar-nav-button {"),
    );
    expect(sharedStateSource).toContain("background: rgb(0 0 0 / 0.05)");
    expect(sharedStateSource).toContain("background: rgb(255 255 255 / 0.08)");
    expect(sharedStateSource).toContain("background: var(--tile-bg)");
    expect(sharedStateSource).toContain("color: var(--accent)");
    expect(sharedStateSource).toContain("transition: background-color var(--motion-fast) ease-out, color var(--motion-fast) ease-out;");
    expect(sharedStateSource).not.toContain("background: var(--selection-bg)");
    expect(sharedStateSource).not.toContain("font-weight: 600");
  });
});
