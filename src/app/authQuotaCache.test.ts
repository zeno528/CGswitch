import { describe, expect, it } from "vitest";
import {
  authQuotaCacheKey,
  getAuthQuotaBalance,
  getAuthQuotaError,
  getVisibleAuthQuota,
  setAuthQuotaFailure,
  setAuthQuotaSuccess,
} from "./authQuotaCache";
import type { ProfileBalanceInfo } from "../types";

const quota = (usage: number): ProfileBalanceInfo => ({
  currency: "",
  total_balance: "",
  granted_balance: "",
  topped_up_balance: "",
  usage_percent: usage,
  usage_reset: null,
  weekly_usage_percent: null,
  weekly_reset: null,
});

describe("shared auth quota state", () => {
  it("lets a known failure hide, but retain, the last successful quota by account", () => {
    const key = authQuotaCacheKey("oauth", `test-${crypto.randomUUID()}`);
    const previous = quota(25);
    setAuthQuotaSuccess(key, previous);

    setAuthQuotaFailure(key, "ChatGPT 登录已失效，请重新登录"); // i18n-exempt: Backend error fixture.

    expect(getAuthQuotaError(key)).toContain("登录已失效"); // i18n-exempt: Backend error fixture.
    expect(getVisibleAuthQuota(key, quota(90))).toBeNull();
    expect(getAuthQuotaBalance(key)).toEqual(previous);
  });

  it("clears the error on a new success and leaves other accounts untouched", () => {
    const id = `test-${crypto.randomUUID()}`;
    const key = authQuotaCacheKey("oauth", id);
    const otherKey = authQuotaCacheKey("oauth", `${id}-other`);
    const next = quota(30);
    setAuthQuotaFailure(key, "query_failed");
    setAuthQuotaFailure(otherKey, "query_failed");

    setAuthQuotaSuccess(key, next);

    expect(getAuthQuotaError(key)).toBe("");
    expect(getVisibleAuthQuota(key, null)).toEqual(next);
    expect(getAuthQuotaError(otherKey)).toBe("query_failed");
  });
});
