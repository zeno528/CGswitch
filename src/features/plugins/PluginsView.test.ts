// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PluginsView.tsx", import.meta.url), "utf8");

describe("插件搜索", () => {
  it("已安装列表接入搜索框并按名称过滤", () => {
    expect(source.split("matchesQuery(plugin, query)").length - 1).toBe(1);
    expect(source.split("<PluginSearchInput").length - 1).toBe(1);
  });
});

// 一级列表（MCP / 插件 / Skill）共用一套大卡片定义。页面各自复制结构、
// 或各起一个行类，都算破坏这条契约——定义只住在 style.css 里一份。
describe("一级列表共用定义", () => {
  const styles = readFileSync(new URL("../../style.css", import.meta.url), "utf8");
  const marketplaceSource = readFileSync(new URL("./PluginMarketplaceView.tsx", import.meta.url), "utf8");
  const pages = [
    source,
    readFileSync(new URL("../mcp/McpView.tsx", import.meta.url), "utf8"),
    readFileSync(new URL("../skills/SkillsView.tsx", import.meta.url), "utf8"),
  ];

  it("三个页面都只写同一个 class 名，不各自造行类", () => {
    for (const page of pages) expect(page).toContain('className="apple-group apple-list-card"');
    expect(styles).not.toContain("plugin-list-row");
    expect(styles).not.toContain("skill-list-row");
  });

  it("插件市场面板内的列表共用同一个容器类，不再各自套行外壳", () => {
    // 面板已有 --gap-card-inline，所以这里只叠 .apple-list-card，不叠 .apple-group（否则双重缩进）
    expect(marketplaceSource).toContain('className="apple-list-card mt-2"');
    expect(marketplaceSource).toContain('className="apple-list-card mt-3"');
    expect(marketplaceSource).not.toContain("shadow-[0_0_0_1px_var(--panel-ring)]");
  });

  it("卡片的定义只有一处：整卡内边距、分割线、行的去卡片化都在 style.css", () => {
    const selectors = [".apple-list-card {", ".apple-group.apple-list-card {", ".apple-list-card > * + * {", ".apple-list-card .apple-list-row {"];
    for (const selector of selectors) expect(styles).toContain(selector);
    // 只钉语义，不钉数值：密度和配色会反复调，画面一动就红的测试没人愿意留
    expect(styles).toMatch(/\.apple-list-card \.apple-list-row \{[^}]*background: transparent/);
    expect(styles).toMatch(/\.apple-list-card \.apple-list-row \{[^}]*box-shadow: none/);
  });
});
