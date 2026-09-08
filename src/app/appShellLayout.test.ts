// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const profileEditSource = readFileSync(new URL("../features/profiles/ProfileEdit.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../style.css", import.meta.url), "utf8");

describe("AppShell 布局", () => {
  it("保持侧栏导航紧贴品牌区，并让设置按钮锚定底部", () => {
    expect(source).toContain("apple-sidebar relative h-full shrink-0");
    expect(source).toContain('className="relative mx-1.5 mt-3 space-y-1"');
    expect(source).toContain('className="absolute inset-x-1.5 bottom-4 flex flex-col gap-1.5"');
  });

  it("让窗口控制区与主卡片仅保留微小间隙", () => {
    expect(styles).toContain("--window-chrome-height: 1.875rem;");
    expect(styles).toContain("margin: 0.125rem 0.3125rem 0.3125rem 0;");
  });

  it("将通知条与页面顶部操作按钮对齐", () => {
    expect(styles).toContain(".app-toast-viewport {\n  position: fixed;\n  top: 2.5rem;");
  });

  it("拖拽时不改变供应商标题颜色", () => {
    expect(styles).not.toContain(".profile-drag-preview.is-drag-hover h3");
  });

  it("编辑页滚动条收在主卡片边界内", () => {
    expect(profileEditSource).toContain('className="apple-edit-content"');
    expect(profileEditSource).toContain('className="apple-group p-0"');
    expect(styles).not.toContain(".apple-edit-card-frame");
  });

  it("将内容区滚动条槽从右侧内边距中扣除", () => {
    expect(styles).toContain("padding-right: calc(var(--gap-main) - 8px);");
  });

  it("让编辑页的表单大卡片与主视图使用相同圆角", () => {
    expect(styles).toContain(".apple-edit-content > .apple-group {\n  margin-top: 0;\n  border-radius: var(--radius-card);");
  });

  it("将 Skill 更新徽标锚定在导入按钮左上角", () => {
    expect(styles).toContain(".skill-update-badge {\n  position: absolute;\n  left: -0.45rem;\n  top: -0.45rem;");
  });

  it("让配置编辑器仅保留横向滚动", () => {
    expect(styles).toContain(".cm-editor .cm-scroller { overflow-x: auto; overflow-y: hidden; }");
  });

  it("让供应商卡片使用略圆的圆角", () => {
    expect(styles).toContain(".profile-list > .apple-group,\n.profile-drag-preview {\n  border-radius: var(--radius-card);");
  });

  it("新增带官网预设时显示官网地址输入框", () => {
    expect(profileEditSource).toContain("(!create || Boolean(selectedPreset?.admin_url))");
    expect(profileEditSource).not.toContain("(!create || selectedPreset?.base_url)");
  });
});
