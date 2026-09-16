// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareMarketplacePlugins, comparePlugins, matchesQuery, resolveAliasInstalled } from "./PluginsView";

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

  it("仅按插件名忽略大小写匹配，不搜显示名与描述", () => {
    const plugin = { name: "app-69ea", display_name: "Exa", description: "Web search for AI" };
    expect(matchesQuery(plugin, "")).toBe(true);
    expect(matchesQuery(plugin, "app")).toBe(true);
    expect(matchesQuery(plugin, "  APP-69 ")).toBe(true);
    expect(matchesQuery(plugin, "exa")).toBe(false); // 显示名不参与
    expect(matchesQuery(plugin, "search for ai")).toBe(false); // 描述不参与
    expect(matchesQuery(plugin, "figma")).toBe(false);
  });
});

describe("搜索快捷键", () => {
  it("搜索框支持 Ctrl/Cmd+K 聚焦并全选", () => {
    expect(source).toContain("(event.ctrlKey || event.metaKey)");
    expect(source).toContain('event.key.toLowerCase() === "k"');
    expect(source).toContain("inputRef.current?.focus()");
    expect(source).toContain("inputRef.current?.select()");
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

describe("别名安装纠正", () => {
  it("未安装条目命中已安装名单时翻转为已安装，其余保持原状", () => {
    const plugin = (name: string, installed: boolean) =>
      ({ plugin_id: `${name}@m`, name, installed }) as Parameters<typeof resolveAliasInstalled>[0][number];
    const input = [plugin("canva", false), plugin("grill", false), plugin("github", true)];
    const resolved = resolveAliasInstalled(input, new Set(["canva", "notion"]));
    expect(resolved.map((item) => item.installed)).toEqual([true, false, true]);
    expect(input.map((item) => item.installed)).toEqual([false, false, true]); // 原数组不被就地修改
  });
});

describe("市场明细排序", () => {
  it("已安装在前，组内按名称", () => {
    const plugin = (name: string, installed: boolean) =>
      ({ name, installed }) as Parameters<typeof compareMarketplacePlugins>[0];
    const ordered = [
      plugin("zeta", false),
      plugin("canva", true),
      plugin("beta", false),
      plugin("app-69ea", true),
    ].sort(compareMarketplacePlugins);
    expect(ordered.map((item) => item.name)).toEqual(["app-69ea", "canva", "beta", "zeta"]);
  });
});
