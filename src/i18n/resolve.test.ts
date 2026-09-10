import { describe, expect, it } from "vitest";
import { resolveLanguage } from "./resolve";

describe("resolveLanguage", () => {
  it("显式设置的语言优先于系统语言", () => {
    expect(resolveLanguage("zh-CN", "en-US")).toBe("zh-CN");
    expect(resolveLanguage("en-US", "zh-CN")).toBe("en-US");
  });

  it("跟随系统时，中文语系归到 zh-CN", () => {
    expect(resolveLanguage("system", "zh-CN")).toBe("zh-CN");
    expect(resolveLanguage("system", "zh")).toBe("zh-CN");
    expect(resolveLanguage("system", "zh-TW")).toBe("zh-CN");
    expect(resolveLanguage("system", "zh-Hans-CN")).toBe("zh-CN");
  });

  it("跟随系统时，非中文语系归到 en-US", () => {
    expect(resolveLanguage("system", "en-US")).toBe("en-US");
    expect(resolveLanguage("system", "en-GB")).toBe("en-US");
    expect(resolveLanguage("system", "ja-JP")).toBe("en-US");
  });

  it("系统语言缺失或为空时回退 en-US", () => {
    expect(resolveLanguage("system", "")).toBe("en-US");
    expect(resolveLanguage("system", undefined)).toBe("en-US");
  });

  it("系统语言大小写不敏感", () => {
    expect(resolveLanguage("system", "ZH-CN")).toBe("zh-CN");
  });

  it("未识别的设置值按跟随系统处理", () => {
    expect(resolveLanguage(undefined, "zh-CN")).toBe("zh-CN");
    expect(resolveLanguage("", "zh-CN")).toBe("zh-CN");
  });
});
