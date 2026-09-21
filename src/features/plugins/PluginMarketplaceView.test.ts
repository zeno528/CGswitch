// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PluginMarketplaceView.tsx", import.meta.url), "utf8");

describe("插件市场卡片", () => {
  it("显示每个已添加市场的插件总数", () => {
    expect(source).toContain("marketplacePluginCounts");
    expect(source).toContain("refreshMarketplacePlugins(marketplace.name, marketplace.root)");
    expect(source).toContain('t("market.pluginCount"');
    expect(source).toContain('t("market.pluginCountUnavailable"');
  });

  it("市场列表首帧从缓存同步直出，与其他管理页同款", () => {
    // 首帧就是内容：缓存命中时 useState 初始化直接吃缓存，不画一帧转圈
    expect(source).toContain("const cachedMarketplaces = getCachedPluginMarketplaces();");
    expect(source).toContain("useState<PluginMarketplace[]>(cachedMarketplaces ?? [])");
    expect(source).toContain("useState(cachedMarketplaces !== null)");
  });
});
