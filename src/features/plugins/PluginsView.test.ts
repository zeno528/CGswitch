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
