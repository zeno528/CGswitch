// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8");
const hooksSource = readFileSync(new URL("./appShellHooks.ts", import.meta.url), "utf8");
const profileEditSource = readFileSync(new URL("../features/profiles/ProfileEdit.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../style.css", import.meta.url), "utf8");

describe("AppShell 布局", () => {
  it("保持侧栏导航紧贴品牌区，并让账号和设置按钮锚定底部", () => {
    expect(source).toContain("apple-sidebar relative h-full shrink-0");
    expect(source).toContain('className="mx-1.5 mt-3 space-y-1"');
    expect(source).toContain('className="absolute inset-x-1.5 bottom-4 flex flex-col gap-1.5"');
  });

  it("重复点击当前侧栏页面时不重置页面", () => {
    for (const view of ["profiles", "mcp", "plugins", "skills", "accounts", "settings"]) {
      expect(source).toContain(`if (view === "${view}") return;`);
    }
  });

  it("只在窗口从非激活状态恢复时刷新", () => {
    expect(hooksSource).toContain("const activeRef = useRef(!document.hidden);");
    expect(hooksSource).toContain("if (activeRef.current) return false;");
    expect(hooksSource).toContain("if (!activeRef.current) return false;");
    expect(source).toContain("if (!activate()) return;");
    expect(source).toContain("if (!deactivate()) return;");
    expect(source).toContain("if (isTauri && appWindow) {");
    expect(source).toContain("appWindow.onFocusChanged");
    expect(source).toContain("appWindow.isFocused()");
  });

  it("账号入口固定在设置入口上方，并通过全局视图打开", () => {
    expect(source).toContain('data-active={view === "accounts" ? "true" : undefined}');
    expect(source.indexOf('data-active={view === "accounts" ? "true" : undefined}')).toBeLessThan(source.indexOf('data-active={view === "settings" ? "true" : undefined}'));
    expect(source).toContain('onManageChatgptAccounts={goAccounts}');
  });

  it("首屏完成后才启动自动更新检查", () => {
    expect(source).toContain("const [startupReady, setStartupReady] = useState(false);");
    expect(source).toContain("setStartupReady(true);");
    expect(source).toContain('<AppUpdateProvider enabled={Boolean(state?.settings.auto_check_update) && startupReady} ready={startupReady}>');
    expect(source.indexOf("setStartupReady(true);")).toBeGreaterThan(source.indexOf("await appWindow?.show();"));
  });

  it("认证快照由全局状态完成后再交给配置编辑页", () => {
    expect(hooksSource).toContain("const [authStatusReady, setAuthStatusReady] = useState(false);");
    expect(hooksSource).toContain("setAuthStatusReady(true);");
    expect(source).toContain("authStatusReady={authStatusReady}");
    expect(source).toContain("onAuthStatusChange={updateAuthStatus}");
  });

  it("移除侧栏激活装饰条，并固定悬浮卡片为普通字重", () => {
    expect(source).not.toContain("apple-sidebar-indicator");
    expect(source).toContain('const navClass = "apple-sidebar-nav-button app-selection-state";');
    expect(source).toContain('data-active={view === "settings" ? "true" : undefined}');
    expect(source).not.toContain('active ? "bg-(--tile-bg) text-accent" :');
    expect(source).not.toContain('active ? "bg-(--selection-bg) text-accent" :');
    expect(source).not.toContain('active ? "bg-(--selection-bg) font-semibold text-accent" :');
    // 侧栏标签的颜色两主题都靠继承 body（浅 #1c1c1e / 深 #ffffff），激活项继承按钮的 text-accent。
    // 禁止再给标签写直接 color 规则：它会压过继承，让激活态在深色下不变色。
    expect(styles).not.toContain(".apple-sidebar-nav-button .apple-sidebar-label");
    expect(styles).not.toContain(".apple-sidebar-indicator");
    expect(styles).toMatch(/\.apple-sidebar-flyout \{[\s\S]*font-weight: 400;/);
    expect(styles).toContain("color: var(--text-primary);");
  });

  it("让设置项说明在浅色和深色主题都保持弱层级", () => {
    const descriptionStyles = styles.match(/\.setting-description \{[\s\S]*?\n\}/)?.[0];
    expect(descriptionStyles).toContain("color: var(--text-secondary);");
    expect(descriptionStyles).toContain("font-weight: 400;");
    expect(styles).toContain(":root.dark .setting-description {\n  color: var(--text-secondary);\n}");
  });

  it("让窗口控制区底边与主卡片顶边重合", () => {
    expect(styles).toContain("--window-chrome-height: 2rem;");
    expect(styles).toContain("margin: 0 3px 3px 0;");
  });

  it("浅色主题的侧栏与窗口标题栏使用统一背景色", () => {
    expect(styles).toContain("--sidebar-bg: var(--panel-bg);");
    expect(styles).toMatch(/\.apple-window-chrome \{[\s\S]*?background: var\(--sidebar-bg\);/);
    expect(styles).toMatch(/\.apple-sidebar \{[\s\S]*?background: var\(--sidebar-bg\);/);
  });

  it("让全局卡片浅色使用微暖白、深色保持原卡片底色", () => {
    expect(styles).toContain("--panel-bg: #f5f5f5;");
    expect(styles).toContain("--panel-bg: #292b30;");
    expect(styles).toMatch(/\.apple-group \{[\s\S]*?background: var\(--panel-bg\);/);
    expect(styles).toMatch(/\.panel \{[\s\S]*?background: var\(--panel-bg\);/);
  });

  it("让主内容表面浅色使用白色、深色使用 #1e1e1e", () => {
    expect(styles).toContain("--main-surface-bg: #ffffff;");
    expect(styles).toContain("--main-surface-bg: #1e1e1e;");
    expect(styles).toContain("--input-bg: var(--main-surface-bg);");
    expect(styles).toMatch(/\.apple-main-card \{[\s\S]*?background: var\(--main-surface-bg\);/);
    expect(styles).toMatch(/\.apple-page-bar \{[\s\S]*?background: var\(--main-surface-bg\);/);
    expect(styles).toMatch(/\.apple-edit-toolbar--footer \{[\s\S]*?background: var\(--main-surface-bg\);/);
  });

  it("让捕获配置图标按钮保持圆形", () => {
    expect(styles).toContain(".apple-toolbar-group > .apple-icon-button {\n  border-radius: 999px;");
  });

  it("让 Codex 状态操作组使用主题表面,仅圆点承载运行色并让运行圆点呼吸", () => {
    const capsuleStyles = styles.match(/\.codex-status-control \{[\s\S]*?\n\}/)?.[0] ?? "";
    const signalStyles = styles.match(/\.codex-status__signal \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(capsuleStyles).toContain("border: 1px solid var(--primary-button-hover-bg);");
    expect(capsuleStyles).toContain("background: var(--primary-button-bg);");
    expect(styles).not.toContain("color-mix(in srgb, var(--success) 18%, var(--panel-ring))");
    expect(signalStyles).toContain("color: color-mix(in srgb, var(--primary-button-text) 65%, transparent);");
    expect(signalStyles).toContain("background: transparent;");
    expect(styles).not.toContain("color-mix(in srgb, var(--text-secondary) 8%, transparent)");
    expect(styles).toContain(".codex-status--running .codex-status__signal {\n  color: var(--success);\n}");
    expect(styles).toContain(".codex-status__signal-dot {\n  position: relative;\n  isolation: isolate;\n  width: 0.375rem;\n  height: 0.375rem;");
    expect(styles).toContain(".codex-status--running .codex-status__signal-dot {\n  animation: codex-status-breathe 2.8s ease-in-out infinite;");
    expect(styles).toContain("0%, 100% { transform: scale(1); }\n  50% { transform: scale(1.3); }");
    expect(styles).toContain(".codex-status__signal-dot::after {");
    expect(styles).toContain("background: currentColor;");
    expect(styles).toContain("filter: blur(2px);");
    expect(styles).toContain(".codex-status--running .codex-status__signal-dot::after {\n  animation: codex-status-breathe-halo 2.8s ease-in-out infinite;");
    expect(styles).toContain("@keyframes codex-status-breathe-halo {");
    expect(styles).toContain("0%, 100% { opacity: 0; transform: scale(1); }\n  50% { opacity: 0.18; transform: scale(1.35); }");
    expect(styles).not.toContain("codex-status-halo");
    expect(styles).not.toContain("codex-status-sheen");
    expect(styles).not.toContain(".codex-status--running::after");
    expect(styles).toContain(".codex-status__action {");
    expect(styles).toContain("border-radius: 50%;");
    expect(styles).toContain("width: calc(var(--control-height) - 0.125rem);");
    expect(styles).toContain("height: calc(var(--control-height) - 0.125rem);");
    expect(styles).toContain("margin: 0.125rem;");
    expect(styles).toContain("border: 0;");
    expect(styles).toContain("background: color-mix(in srgb, currentColor 12%, transparent);");
  });

  it("让标题栏药丸共用统一高度", () => {
    expect(styles).toContain("--toolbar-control-height: calc(var(--control-height) + 2px);");
    expect(styles).toContain(".update-notice-trigger {\n  display: inline-flex;\n  min-width: var(--icon-button-size);\n  min-height: var(--toolbar-control-height);");
    expect(styles).toContain(".codex-status-control {\n  display: inline-flex;\n  height: var(--toolbar-control-height);");
    expect(styles).toContain(".apple-action-button {\n  align-items: center;");
    expect(styles).toContain("height: var(--toolbar-control-height);");
    expect(styles).toContain(".app-input--pill {\n  height: var(--toolbar-control-height);");
  });

  it("让主题分段控件与工具栏容器共用药丸圆角", () => {
    expect(styles).toContain(".apple-toolbar-group,\n.apple-segmented-control {\n  border-radius: 999px;");
  });

  it("让共享面板的分割线与内容左右内边距对齐", () => {
    expect(styles).toContain(".apple-panel-section + .apple-panel-section {\n  position: relative;\n  border-top: 0;");
    expect(styles).toContain(".apple-panel-section + .apple-panel-section::before {\n  content: \"\";\n  position: absolute;\n  top: 0;\n  right: var(--gap-card-inline);\n  left: var(--gap-card-inline);\n  border-top: 1px solid var(--panel-divider);");
  });

  it("让配置卡片与独立列表卡片复用全局描边", () => {
    expect(styles).toContain("--card-edge-shadow: 0 0 0 0.5px var(--panel-border);");
    expect(styles).toContain(".panel,\n.apple-group,\n.apple-list-row,\n.apple-editor-surface {\n  box-shadow: var(--card-edge-shadow);");
  });

  it("让技能预览器的 Markdown 分割线使用全局分割线", () => {
    expect(styles).toContain(".skill-markdown-preview hr {\n  border: 0;\n  border-top: 1px solid var(--panel-divider);");
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

  it("编辑页在详情完成后再一次性揭示，保留页面进入动画", () => {
    expect(styles).toContain("@keyframes apple-page-enter {\n  from { transform: translateY(6px); }");
    expect(styles).toContain(".apple-page-enter {\n  display: flex;");
    expect(styles).toContain(".apple-page-enter > :is(.apple-scroll-page, .apple-edit-page) > .apple-edit-content {\n  animation: apple-page-enter");
    expect(profileEditSource).toContain("if (((!create && !detail) || authStatusPending) && !loadError) return null;");
  });

  it("将内容区滚动条槽从右侧内边距中扣除", () => {
    expect(styles).toContain("padding-right: calc(var(--gap-main) - 8px);");
  });

  it("让编辑页的表单大卡片与主视图使用相同圆角", () => {
    expect(styles).toContain(".apple-edit-content > .apple-group {\n  margin-top: 0;\n  border-radius: var(--radius-card);");
  });

  it("将 Skill 更新徽标锚定在导入按钮右上角", () => {
    expect(styles).toContain(".apple-count-badge {\n  position: absolute;\n  left: auto;\n  right: -0.45rem;\n  top: -0.45rem;");
  });

  it("让配置编辑器的横向滚动条从行号栏右侧开始", () => {
    expect(styles).toContain("max-height: min(34rem, 60vh);");
    expect(styles).toContain(".cm-editor .cm-scroller { overflow-x: hidden; overflow-y: auto; overscroll-behavior: contain; }");
    expect(styles).toContain(".cm-horizontal-scrollbar {");
    expect(styles).toContain(".cm-horizontal-scrollbar-row {");
    expect(styles).toContain(".cm-horizontal-scrollbar-gutter {");
  });

  it("取消编辑器外围的焦点发光描边", () => {
    expect(styles).toContain(".cm-editor.cm-focused { outline: none; }");
    expect(styles).not.toContain(".apple-editor-shell:focus-within");
  });

  it("让有溢出的滚动条常驻显示缩略图", () => {
    expect(styles).toContain("*::-webkit-scrollbar-thumb {\n  background: var(--scrollbar-thumb);");
    expect(styles).toContain("scrollbar-color: var(--scrollbar-thumb) transparent;");
    expect(styles).not.toContain("*:hover::-webkit-scrollbar-thumb {\n  background: var(--scrollbar-thumb);");
  });

  it("避免侧栏宽度动画期间重测主区域滚动条占位", () => {
    expect(source).not.toContain("new ResizeObserver(updateScrollbarSize)");
    expect(source).toContain("updateScrollbarSize();");
  });

  it("让供应商卡片使用略圆的圆角", () => {
    expect(styles).toContain(".profile-list > .apple-group,\n.profile-drag-preview {\n  border-radius: var(--radius-card);");
  });

  it("新增带官网预设时显示官网地址输入框", () => {
    expect(profileEditSource).toContain("(!create || Boolean(selectedPreset?.admin_url))");
    expect(profileEditSource).not.toContain("(!create || selectedPreset?.base_url)");
  });

  it("官网地址按钮复用行内按钮样式并显示文案", () => {
    expect(profileEditSource).toContain('className="apple-inline-btn apple-inline-btn--quiet !h-5 shrink-0"');
    expect(profileEditSource).toContain('{t("card.openWebsite")}');
  });
});
