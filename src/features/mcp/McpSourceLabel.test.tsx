import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setupI18n } from "../../i18n";
import { McpSourceLabel } from "./McpSourceLabel";

setupI18n("zh-CN");

describe("MCP 源码未保存标记", () => {
  it.each(["TOML 源码", "JSON 源码"])("%s 初始化、修改和还原使用相同的标记规则", (label) => {
    const original = "original\n";
    for (const [value, initialized, dirty] of [
      [original, false, false],
      ["modified\n", false, false],
      [original, true, false],
      ["original\r\n", true, false],
      ["modified\n", true, true],
      [original, true, false],
    ] as const) {
      const markup = renderToStaticMarkup(
        <McpSourceLabel label={label} value={value} initialValue={original} initialized={initialized} />,
      );
      expect(markup).toContain(label);
      expect(markup.includes('aria-label="有未保存的改动"')).toBe(dirty);
    }
  });
});
