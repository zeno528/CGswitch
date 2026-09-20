// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { authQuotaErrorKind } from "../../app/authQuotaCache";

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

  it("所有配置激活时复用全局品牌渐变", () => {
    expect(source).toContain('active ? " is-active brand-gradient-surface" : ""');
    expect(source).not.toContain('profile.kind === "official" ? " brand-gradient-surface" : ""');
    expect(source).not.toContain("third-party-gradient");
    expect(styles).not.toContain(".profile-list > .apple-group.is-active:not(.brand-gradient-surface)");
    expect(styles).toContain(".profile-drag-preview.is-active {");
    expect(styles).toContain("--brand-gradient-start: #263b63;");
    expect(styles).toContain("--brand-gradient-middle: #3f72b8;");
    expect(styles).toContain("--brand-gradient-start-mix: 34%;");
    expect(styles).toContain("--brand-gradient-middle-mix: 58%;");
    expect(styles).toContain(":root.dark {\n  color-scheme: dark;");
    expect(styles).toContain(".brand-gradient-surface {\n  background-image: linear-gradient(90deg, color-mix(in srgb, var(--brand-gradient-start) var(--brand-gradient-start-mix), transparent) 0%, color-mix(in srgb, var(--brand-gradient-blend) var(--brand-gradient-blend-mix), transparent) 20%, color-mix(in srgb, var(--brand-gradient-middle) var(--brand-gradient-middle-mix), transparent) 40%, color-mix(in srgb, var(--brand-gradient-middle) var(--brand-gradient-fade-mix), transparent) 58%, transparent 100%);");
  });

  it("激活卡沿用主题文字层级", () => {
    expect(styles).not.toContain("--active-card-text-primary");
    expect(styles).not.toContain("--active-card-text-secondary");
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-meta,\n.profile-drag-preview.brand-gradient-surface .profile-card-meta {\n  color: var(--text-secondary);");
    expect(styles).not.toContain(":root.dark .profile-list > .apple-group.brand-gradient-surface .profile-card-meta .apple-chip");
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .drag-handle {\n  color: var(--text-secondary);");
  });

  it("激活时保留卡片边缘", () => {
    expect(styles).not.toContain(".profile-list > .apple-group.is-active {");
    expect(styles).not.toContain(".profile-list > .apple-group.brand-gradient-surface {");
    expect(styles).toContain(".profile-list > .apple-group:not(.is-active):hover {\n  outline: 1px solid");
    expect(styles).not.toContain(":root.dark .profile-list > .apple-group.is-active {");
  });

  it("激活渐变卡沿用默认卡片的圆角和几何", () => {
    expect(styles).toContain(".apple-group {\n  overflow: hidden;\n  border-radius: var(--radius-card);");
  });

  it("提高渐变卡片的文字与图标对比度", () => {
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-content__text,\n.profile-drag-preview.brand-gradient-surface .profile-card-content__text {\n  color: var(--text-primary);");
    // 选择器用稳定类名而非中文 title/aria-label：文案会随界面语言变化
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-actions > .apple-icon-button:not(.profile-card-delete),\n.profile-drag-preview.brand-gradient-surface .profile-card-content__text .apple-icon-button,");
  });

  it("胶囊底色统一定义在 --chip-bg，配置卡片浅色药丸复用主容器底色", () => {
    expect(styles).toContain("--chip-bg: #e9e9e6;");
    expect(styles).toContain(".apple-chip {\n  align-items: center;\n  background: var(--chip-bg);");
    expect(styles).toContain(".profile-card-meta .apple-chip {\n  background: var(--main-surface-bg);\n  font-size: 12px;");
    expect(styles).toContain(".profile-list > .apple-group.brand-gradient-surface .profile-card-meta .apple-chip,\n.profile-drag-preview.brand-gradient-surface .profile-card-meta .apple-chip {\n  border-color: color-mix(in srgb, var(--primary-button-bg) 22%, transparent);\n  background: var(--main-surface-bg);\n  color: color-mix(in srgb, var(--primary-button-bg) 82%, transparent);");
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

  it("仅在端点或 API Key 缺失时禁用连通测试", () => {
    expect(source).toContain("const connectionDisabled = profile.provider ? !profile.has_base_url || !profile.has_key : false;");
    expect(source).toContain('!profile.has_base_url ? t("connection.missingApiEndpointWarning")');
    expect(source).not.toContain("missingApiCredentialsWarning");
  });

  it("仅主动点击余额药丸才播放刷新动效，刷新逻辑保持原样", () => {
    // 动效只由点击回调开关，静默路径（挂载/聚焦/轮询）不触发
    expect(source).toContain("const [balanceRefreshing, setBalanceRefreshing] = useState(false);");
    expect(source).toContain("{balanceRefreshing ? <LoadingSpinner size=\"sm\" /> : <Gauge");
    expect(source).toContain("aria-busy={balanceRefreshing}");
    expect(source).toContain("setBalanceRefreshing(true);");
    expect(source).toContain("void fetchBalance(manual).finally(() => setBalanceRefreshing(false));");
    expect(authQuotaErrorKind("refresh_token 被服务端拒绝，该账号需要重新登录")).toBe("auth_expired"); // i18n-exempt: Backend error fixture.
    expect(authQuotaErrorKind("Network request timed out")).toBe("query_failed");
    expect(source).toContain('feedback.error(t(authInvalid ? "balance.authInvalidToast" : "balance.queryFailedToast"));');
    // 单飞去重把在途 promise 交回调用方：指示器跟随真正落地的查询，不留真空期
    expect(source).toContain("if (balanceInFlightRef.current) return balanceInFlightRef.current;");
  });

  it("切页后的静默额度刷新延后到页面进入动画（800ms）结束之后", () => {
    expect(source).toContain("window.setTimeout(() => void fetchBalance(), active ? 900 : 1200);");
    expect(source).not.toContain("lastSeenEpoch");
  });
});
