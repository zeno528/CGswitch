// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProfilesView.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const cardSource = readFileSync(new URL("./ProfileCard.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../style.css", import.meta.url), "utf8");

describe("ProfilesView 拖拽预览", () => {
  it("将拖拽浮层挂到 body，避免被页面 transform 容器偏移", () => {
    expect(source).toContain('import { createPortal } from "react-dom";');
    expect(source).toContain("createPortal(<DragOverlay");
    expect(source).toContain("document.body");
  });

  it("源卡片在拖拽收尾时立即恢复显隐，避免释放瞬间渐隐", () => {
    expect(cardSource).not.toContain("group flex cursor-pointer select-none flex-col gap-4 px-5 py-4.5 transition-opacity duration-150 sm:flex-row");
  });

  it("排序保存成功后同步父级状态，切页回来仍保留新顺序", () => {
    expect(source).toContain("await api.reorderProfiles(next.map((item) => item.id));\n      await onRefresh();");
  });

  it("激活卡的拖拽预览复用品牌渐变且不再覆盖旧底色", () => {
    expect(source).toContain('active ? "is-active brand-gradient-surface is-drag-hover" : "is-drag-hover"');
    expect(source).not.toContain('active ? "is-active is-drag-hover" : "is-drag-hover"');
    expect(styles).not.toContain(".profile-drag-preview.is-active {\n  background-image: linear-gradient(");
    expect(styles).not.toContain("--profile-active-bg:");

    const activePreviewRuleStart = styles.indexOf(".profile-drag-preview.is-active {");
    const activePreviewRuleEnd = styles.indexOf("}", activePreviewRuleStart);
    expect(styles.slice(activePreviewRuleStart, activePreviewRuleEnd)).not.toContain("outline:");
    expect(styles).not.toContain(":root.dark .profile-drag-preview.is-active {");
  });

  it("激活卡拖拽预览的官网与登录标识沿用浅色文字层级", () => {
    // 选择器用稳定类名而非中文 title/aria-label：文案会随界面语言变化
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-content__text .apple-icon-button,\n.profile-list > .apple-group.brand-gradient-surface .profile-card-actions > .apple-icon-button:not(.profile-card-delete),\n.profile-drag-preview.brand-gradient-surface .profile-card-content__text .apple-icon-button,\n.profile-drag-preview.brand-gradient-surface .profile-card-actions > .apple-icon-button:not(.profile-card-delete) {\n  color: var(--active-card-text-primary);");
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-auth-badge,\n.profile-drag-preview.brand-gradient-surface .profile-card-auth-badge {\n  border-color: color-mix(in srgb, var(--active-card-text-primary) 22%, transparent);\n  background: color-mix(in srgb, var(--active-card-text-primary) 12%, transparent);\n  color: var(--active-card-text-primary);");
  });
});
