// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProfileCard.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../style.css", import.meta.url), "utf8");

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

  it("官方配置激活时使用 ChatGPT 品牌渐变", () => {
    expect(source).toContain('active && profile.kind === "official" ? " brand-gradient-surface" : ""');
    expect(styles).toContain(".profile-list > .apple-group.is-active:not(.brand-gradient-surface),\n.profile-drag-preview.is-active {");
  });

  it("提高官方渐变卡片的文字与图标对比度", () => {
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-content__text {\n  color: var(--primary-button-bg);");
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-meta {\n  color: color-mix(in srgb, var(--primary-button-bg) 72%, transparent);");
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-meta .apple-chip {");
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-actions > .apple-icon-button:not([title=\"删除\"]) {");
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface [aria-label*=\"登录\"] {");
  });

  it("统一普通胶囊与卡片胶囊的浅色底色", () => {
    expect(styles).toContain("--chip-bg: #e9e9e6;");
    expect(styles).toContain(".apple-chip {\n  align-items: center;\n  background: var(--chip-bg);");
    expect(styles).toContain(".profile-card-meta .apple-chip {\n  font-size: 12px;");
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-meta .apple-chip {\n  border-color:");
    expect(styles).toContain("  background: var(--chip-bg);\n  color: color-mix(in srgb, var(--primary-button-bg) 82%, transparent);");
  });

  it("让浅色模式的用量成功百分比使用高对比度绿色", () => {
    expect(styles).toContain("--success-text: #27c840;");
    expect(styles).toContain(".chip-success {\n  color: var(--success-text);");
  });

  it("用普通文字显示推理等级", () => {
    expect(source).toContain('{profile.reasoning_effort ? <><span aria-hidden="true">·</span><span>{profile.reasoning_effort}</span></> : null}');
    expect(source).not.toContain('<span className="apple-chip">{profile.reasoning_effort}</span>');
  });
});
