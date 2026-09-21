// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MarketplaceDetailView.tsx", import.meta.url), "utf8");

describe("市场目录缓存直出", () => {
  it("数量明细与详情列表都走缓存 + 静默刷新", () => {
    expect(source).toContain("getCachedMarketplacePlugins(marketplace.name)");
    expect(source).toContain("refreshMarketplacePlugins(marketplace.name, marketplace.root)");
    // 安装/卸载回写缓存，避免下次进入闪回旧状态。
    expect(source).toContain("setCachedMarketplacePlugins(marketplace.name, next)");
  });
});

describe("市场明细搜索", () => {
  it("详情列表接入搜索框并按名称过滤", () => {
    expect(source.split("matchesQuery(plugin, query)").length - 1).toBe(1);
    expect(source.split("<PluginSearchInput").length - 1).toBe(1);
  });
});

describe("市场明细更新职责", () => {
  it("详情页不再承载单插件升级，更新入口只保留在市场首页", () => {
    expect(source).not.toContain("onUpgrade");
  });
});
