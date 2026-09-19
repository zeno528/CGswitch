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
