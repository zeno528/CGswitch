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

  it("所有配置激活时使用 ChatGPT 品牌渐变", () => {
    expect(source).toContain('active ? " is-active brand-gradient-surface" : ""');
    expect(source).not.toContain('profile.kind === "official" ? " brand-gradient-surface" : ""');
    expect(source).not.toContain("third-party-gradient");
    expect(styles).not.toContain(".profile-list > .apple-group.is-active:not(.brand-gradient-surface)");
    expect(styles).toContain(".profile-drag-preview.is-active {");
  });

  it("激活卡使用深色主题的浅色文字层级", () => {
    expect(styles).toContain("--active-card-text-primary: #ffffff;");
    expect(styles).toContain("--active-card-text-secondary: rgba(255, 255, 255, 0.68);");
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-meta,\n.profile-drag-preview.brand-gradient-surface .profile-card-meta {\n  color: var(--active-card-text-secondary);");
    expect(styles).toContain(":root.dark .profile-list > .apple-group.brand-gradient-surface .profile-card-meta .apple-chip,\n:root.dark .profile-drag-preview.brand-gradient-surface .profile-card-meta .apple-chip {\n  background: var(--chip-bg);");
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .drag-handle {\n  color: var(--active-card-text-secondary);");
  });

  it("激活时不显示描边，但悬停时保留描边", () => {
    const activeRuleStart = styles.indexOf(".profile-list > .apple-group.is-active {");
    const activeRuleEnd = styles.indexOf("}", activeRuleStart);
    const activeRule = styles.slice(activeRuleStart, activeRuleEnd);

    expect(activeRule).toContain("box-shadow: none;");
    expect(activeRule).not.toContain("outline:");
    expect(styles).toContain(".profile-list > .apple-group:not(.is-active):hover {\n  outline: 1px solid");
    expect(styles).not.toContain(":root.dark .profile-list > .apple-group.is-active {");
  });

  it("提高渐变卡片的文字与图标对比度", () => {
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-content__text,\n.profile-drag-preview.brand-gradient-surface .profile-card-content__text {\n  color: var(--active-card-text-primary);");
    // 选择器用稳定类名而非中文 title/aria-label：文案会随界面语言变化
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-actions > .apple-icon-button:not(.profile-card-delete),\n.profile-drag-preview.brand-gradient-surface .profile-card-content__text .apple-icon-button,");
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-auth-badge,\n.profile-drag-preview.brand-gradient-surface .profile-card-auth-badge {");
  });

  it("胶囊底色统一定义在 --chip-bg，激活卡使用浅色药丸文字", () => {
    expect(styles).toContain("--chip-bg: #e9e9e6;");
    expect(styles).toContain(".apple-chip {\n  align-items: center;\n  background: var(--chip-bg);");
    expect(styles).toContain(".profile-card-meta .apple-chip {\n  background: var(--app-bg);\n  font-size: 12px;");
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-meta .apple-chip,\n.profile-drag-preview.brand-gradient-surface .profile-card-meta .apple-chip {\n  border-color: color-mix(in srgb, var(--primary-button-bg) 22%, transparent);\n  background: var(--app-bg);\n  color: color-mix(in srgb, var(--primary-button-bg) 82%, transparent);");
  });

  it("让浅色模式的用量成功百分比使用高对比度绿色", () => {
    expect(styles).toContain("--success-text: #27c840;");
    expect(styles).toContain(".chip-success {\n  color: var(--success-text);");
  });

  it("用普通文字显示推理等级", () => {
    expect(source).toContain('{profile.reasoning_effort ? <><span aria-hidden="true">·</span><span>{profile.reasoning_effort}</span></> : null}');
    expect(source).not.toContain('<span className="apple-chip">{profile.reasoning_effort}</span>');
  });

  it("余额按钮获得焦点时不显示卡片操作区", () => {
    expect(source).toContain("focus-within:pointer-events-auto focus-within:opacity-100");
    expect(source).not.toContain("group-focus-within:");
  });
});
