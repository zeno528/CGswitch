// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isOAuthLoginExpiredError } from "./AccountsView";

const source = readFileSync(new URL("./AccountsView.tsx", import.meta.url), "utf8");

describe("OAuth account quota recovery", () => {
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
    expect(dialogSource).toContain('closeClassName="oauth-modal-close"');
    expect(dialogSource).toContain("dismissible={false}");
  });
});
