import { describe, expect, it } from "vitest";
import { isOAuthLoginExpiredError } from "./AccountsView";

describe("OAuth account quota recovery", () => {
  it("recognizes expired credentials without treating network failures as re-login cases", () => {
    expect(isOAuthLoginExpiredError("Refresh Token 失效或已过期")).toBe(true); // i18n-exempt: Backend error fixture.
    expect(isOAuthLoginExpiredError("refresh_token 被服务端拒绝，该账号需要重新登录")).toBe(true); // i18n-exempt: Backend error fixture.
    expect(isOAuthLoginExpiredError("ChatGPT 登录已失效，请重新登录")).toBe(true); // i18n-exempt: Backend error fixture.
    expect(isOAuthLoginExpiredError("OAuth refresh token endpoint timed out")).toBe(false);
    expect(isOAuthLoginExpiredError("Network request timed out")).toBe(false);
  });
});
