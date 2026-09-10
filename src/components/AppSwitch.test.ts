// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styleSource = readFileSync(new URL("../style.css", import.meta.url), "utf8");

describe("AppSwitch styles", () => {
  it("开启态复用主按钮的主题背景色与文字色", () => {
    expect(styleSource).toContain('.app-switch[data-state="checked"] .app-switch-rail { background-color: var(--primary-button-bg); }');
    expect(styleSource).toContain('background: var(--primary-button-text);');
  });
});
