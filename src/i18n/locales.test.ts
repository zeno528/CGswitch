import { describe, expect, it } from "vitest";
import { resources } from "./index";

/** 把嵌套文案对象摊平成 "a.b.c" 形式的键路径。 */
function keyPaths(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("locale 键对齐", () => {
  it("zh-CN 与 en-US 的键集合完全一致（防漏翻）", () => {
    expect(keyPaths(resources["en-US"]).sort()).toEqual(keyPaths(resources["zh-CN"]).sort());
  });
});
