// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { comparePlugins, matchesQuery } from "./PluginsView";

const source = readFileSync(new URL("./PluginsView.tsx", import.meta.url), "utf8");

describe("插件市场卡片", () => {
  it("显示每个已添加市场的插件总数", () => {
    expect(source).toContain("marketplacePluginCounts");
    expect(source).toContain("refreshMarketplacePlugins(marketplace.name, marketplace.root)");
    expect(source).toContain('t("market.pluginCount"');
    expect(source).toContain('t("market.pluginCountUnavailable"');
  });
});

describe("插件搜索", () => {
  it("已安装列表与市场详情列表都接入搜索框", () => {
    // 两个列表各自持有 query 状态并用 matchesQuery 过滤渲染。
    expect(source.split("matchesQuery(plugin, query)").length - 1).toBe(2);
    expect(source.split("<PluginSearchInput").length - 1).toBe(2); // 两处使用（定义为 function 声明）
  });

  it("按名称、显示名、描述忽略大小写匹配", () => {
    const plugin = { name: "app-69ea", display_name: "Exa", description: "Web search for AI" };
    expect(matchesQuery(plugin, "")).toBe(true);
    expect(matchesQuery(plugin, "exa")).toBe(true);
    expect(matchesQuery(plugin, "  EXA ")).toBe(true);
    expect(matchesQuery(plugin, "app-69")).toBe(true);
    expect(matchesQuery(plugin, "search for ai")).toBe(true);
    expect(matchesQuery(plugin, "figma")).toBe(false);
  });
});

describe("市场目录缓存直出", () => {
  it("数量明细与详情列表都走缓存 + 静默刷新", () => {
    expect(source).toContain("getCachedMarketplacePlugins(marketplace.name)");
    expect(source).toContain("refreshMarketplacePlugins(marketplace.name, marketplace.root)");
    // 安装/卸载/升级回写缓存，避免下次进入闪回旧状态。
    expect(source).toContain("setCachedMarketplacePlugins(marketplace.name, next)");
  });
});

describe("插件列表排序", () => {
  it("外部市场 → 内置 runtime 市场 → 官方 curated 市场，组内按名称", () => {
    const plugin = (name: string, origin: string, marketplace: string) =>
      ({ name, origin, marketplace }) as Parameters<typeof comparePlugins>[0];
    const ordered = [
      plugin("app-69ea", "official", "openai-curated-remote"),
      plugin("browser", "official", "openai-bundled"),
      plugin("ponytail", "codex", "ponytail"),
      plugin("documents", "official", "openai-primary-runtime"),
      plugin("gmail", "official", "openai-curated-remote"),
    ].sort(comparePlugins);
    expect(ordered.map((item) => item.name)).toEqual(["ponytail", "browser", "documents", "app-69ea", "gmail"]);
  });
});
