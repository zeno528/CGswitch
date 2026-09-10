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

  it("下拉菜单复用全局卡片的 ring 边框", () => {
    const menuSource = styleSource.slice(
      styleSource.indexOf(".app-select-menu {"),
      styleSource.indexOf(".app-select-menu[data-open"),
    );
    expect(menuSource).toContain("border: 0;");
    expect(menuSource).toContain("var(--panel-ring)");
    expect(menuSource).toContain("0 8px 24px rgb(0 0 0 / 0.12)");
    expect(menuSource).not.toContain("border: 1px solid var(--panel-border)");
  });
});
