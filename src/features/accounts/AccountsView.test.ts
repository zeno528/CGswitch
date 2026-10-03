// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstance } from "i18next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { FeedbackProvider } from "../../app/Feedback";
import { authQuotaCacheKey, setAuthQuotaSuccess } from "../../app/authQuotaCache";
import AccountsView, { animateQuotaProgress, expiryColorClass, isOAuthLoginExpiredError } from "./AccountsView";

const source = readFileSync(new URL("./AccountsView.tsx", import.meta.url), "utf8");

describe("Quota progress animation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([[0, 1], [0.5, 1], [1, 0.5], [1, 0], [1, 1]])(
    "plays explicit keyframes from scale %s to %s and cancels on cleanup",
    (startScale, endScale) => {
      vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
      const cancel = vi.fn();
      const animate = vi.fn(() => ({ cancel }));
      const cleanup = animateQuotaProgress({ animate } as unknown as HTMLSpanElement, startScale, endScale);

      expect(animate).toHaveBeenCalledExactlyOnceWith([
        { transform: `scaleX(${startScale})` },
        { transform: `scaleX(${endScale})` },
      ], { duration: 1000, easing: "cubic-bezier(0.645, 0.045, 0.355, 1)" });
      cleanup?.();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("respects reduced motion and leaves the rendered end value intact", () => {
    vi.stubGlobal("window", { matchMedia: () => ({ matches: true }) });
    const animate = vi.fn();
    expect(animateQuotaProgress({ animate } as unknown as HTMLSpanElement, 1, 0.5)).toBeUndefined();
    expect(animate).not.toHaveBeenCalled();
    expect(source).toContain('transform: animationRevision ? `scaleX(${animationEndScale})` : undefined');
  });
});

describe("OAuth account quota recovery", () => {
  it.each(["desktop", "oauth"] as const)("%s renders persisted renewal before querying even if memory has only usage", (source) => {
    const i18n = createInstance();
    void i18n.init({ lng: "en", resources: { en: { settings: { account: { subscriptionDaysRemaining: "{{count}} days remaining" } } } }, initAsync: false });
    const account = { id: crypto.randomUUID(), login: "account@example.test", authenticated_at: 0, is_default: false, plan_type: "plus", subscription_active_until: Date.now() - 86_400_000 };
    const key = authQuotaCacheKey(source, account.id);
    const usage = { currency: "", total_balance: "", usage_percent: 20, usage_reset: null, weekly_usage_percent: null, weekly_reset: null };
    setAuthQuotaSuccess(key, usage);
    const initialStatus = { authenticated: true, default_account_id: null, accounts: source === "oauth" ? [account] : [], external: source === "desktop" ? [account] : [] };
    const html = renderToStaticMarkup(createElement(I18nextProvider, { i18n }, createElement(FeedbackProvider, null,
      createElement(AccountsView, { initialStatus, balanceCache: { [key]: { ...usage, subscription_renews_at: Date.now() + 30.5 * 86_400_000 } } }),
    )));
    expect(html).toContain("31 days remaining");
    expect(html).not.toContain("0 days remaining");
  });

  it("续期日和重置次数共用临期颜色", () => {
    expect([3, 7, 8].map(expiryColorClass)).toEqual(["text-(--danger)", "text-(--warning)", "muted"]);
    expect(source.match(/<span className=\{expiryColorClass\(days\)\}>/g)).toHaveLength(2);
    expect(source).toContain('className="meta-xs muted"');
    expect(source).toContain('className="whitespace-nowrap text-xs"');
  });

  it("recognizes expired credentials without treating network failures as re-login cases", () => {
    expect(isOAuthLoginExpiredError("Refresh Token 失效或已过期")).toBe(true); // i18n-exempt: Backend error fixture.
    expect(isOAuthLoginExpiredError("refresh_token 被服务端拒绝，该账号需要重新登录")).toBe(true); // i18n-exempt: Backend error fixture.
    expect(isOAuthLoginExpiredError("ChatGPT 登录已失效，请重新登录")).toBe(true); // i18n-exempt: Backend error fixture.
    expect(isOAuthLoginExpiredError("OAuth refresh token endpoint timed out")).toBe(false);
    expect(isOAuthLoginExpiredError("Network request timed out")).toBe(false);
  });

  it("将账号页刷新后的认证快照同步回全局状态", () => {
    expect(source).toContain("onAuthStatusChange?: (status: AuthStatus) => void");
    expect(source).toContain("onAuthStatusChange?.(next);");
  });

  it("两种登录来源都在用量刷新成功后重新读取账号信息", () => {
    const successPath = source.slice(source.indexOf("const refresh = async (manual"), source.indexOf("} catch (cause)"));
    expect(successPath.indexOf("await onRefreshed();")).toBeGreaterThan(successPath.indexOf('setError("");'));
    expect(source.match(/<AccountQuota[^\n]*onRefreshed=\{refreshStatus\}/g)).toHaveLength(2);
  });
});

describe("Add account dialog wiring", () => {
  it("添加账号走卡片弹窗：页头按钮只打开弹窗，不再整页替换为等待视图", () => {
    expect(source).toContain("setAddOpen(true)");
    expect(source).toContain("<AddAccountDialog");
    expect(source).not.toContain("browserLogin) return page");
  });

  it("等待授权期间关闭弹窗会取消浏览器登录，避免无人认领的轮询", () => {
    expect(source).toContain("if (!next && (browserLogin || busy)) cancelBrowserLogin();");
  });

  it("弹窗内含介绍与等待两种视图，且不允许误触关闭（只能走关闭按钮）", () => {
    const dialogSource = readFileSync(new URL("./AddAccountDialog.tsx", import.meta.url), "utf8");
    expect(dialogSource).toContain('className="oauth-intro"');
    expect(dialogSource).toContain('className="oauth-pending"');
    expect(dialogSource).toContain('closeClassName="app-dialog-close oauth-modal-close"');
    expect(dialogSource).toContain("dismissible={false}");
  });
});
