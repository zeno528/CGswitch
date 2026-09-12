// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PluginsView.tsx", import.meta.url), "utf8");

describe("插件市场卡片", () => {
  it("显示每个已添加市场的插件总数", () => {
    expect(source).toContain("marketplacePluginCounts");
    expect(source).toContain("api.listMarketplacePlugins(marketplace.name, marketplace.root)");
    expect(source).toContain('t("market.pluginCount"');
    expect(source).toContain('t("market.pluginCountUnavailable"');
  });
});
