// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProfileCard.tsx", import.meta.url), "utf8");

describe("ProfileCard 官网入口", () => {
  it("将官网入口放在供应商标题行并使用 Globe 图标", () => {
    const titleRow = source.indexOf('<div className="flex min-h-7 items-center gap-2">');
    const metaRow = source.indexOf('<div className="profile-card-meta');
    const adminButton = source.indexOf("{profile.admin_url ? <button");

    expect(source).toContain("Globe");
    expect(source).toContain('className="apple-icon-button !h-6 !w-7 shrink-0 text-accent"');
    expect(source).toContain('className="h-3.5 w-3.5"');
    expect(adminButton).toBeGreaterThan(titleRow);
    expect(adminButton).toBeLessThan(metaRow);
  });
});
