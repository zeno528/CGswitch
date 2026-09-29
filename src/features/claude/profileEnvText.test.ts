import { describe, expect, it } from "vitest";
import { buildSettingsText, hasOneMillionModelSuffix, patchEnvFields, patchEnvValue, patchGitAttribution, patchModelDisplayNames, patchModelMappings, readEnvFields, readEnvValue, readGitAttributionDisabled, readModelDisplayNames, readModelMappings, setOneMillionModelSuffix, splitEnvExtras } from "./profileEnvText";

describe("settings.json 全文与表单同步", () => {
  const raw = '{\n  "model": "opus",\n  "permissions": { "allow": ["Read"] },\n  "env": { "ANTHROPIC_BASE_URL": "https://a.example", "CUSTOM": "keep" }\n}\n';

  it("快照原文完整回显，表单读取嵌套 env", () => {
    expect(buildSettingsText({ raw_settings: raw, base_url: null, auth_token: null, model: null, extra_env: null })).toBe(raw);
    expect(readEnvFields(raw)).toEqual({ baseUrl: "https://a.example", authToken: "", model: "" });
  });

  it("表单仅修改 env，保留顶层配置与其他 env 键", () => {
    expect(patchEnvFields(raw, { baseUrl: "https://a.example", authToken: "", model: "" })).toBe(raw);
    const patched = patchEnvFields(raw, { baseUrl: "https://b.example", authToken: "tok", model: "" });
    expect(JSON.parse(patched)).toEqual({
      model: "opus", permissions: { allow: ["Read"] },
      env: { ANTHROPIC_BASE_URL: "https://b.example", ANTHROPIC_AUTH_TOKEN: "tok", CUSTOM: "keep" },
    });
    expect(readEnvFields(patched)).toEqual({ baseUrl: "https://b.example", authToken: "tok", model: "" });
  });

  it("旧快照构造完整文件，保存拒绝无效 env", () => {
    expect(JSON.parse(buildSettingsText({ raw_settings: null, base_url: "https://a.example", auth_token: "tok", model: null, extra_env: '{"CUSTOM":"keep"}' }))).toEqual({
      env: { CUSTOM: "keep", ANTHROPIC_BASE_URL: "https://a.example", ANTHROPIC_AUTH_TOKEN: "tok" },
    });
    expect(JSON.parse(splitEnvExtras(raw)!)).toEqual({ CUSTOM: "keep" });
    expect(splitEnvExtras('{"model":"opus"}')).toBeNull();
    expect(splitEnvExtras('{"env":{"ANTHROPIC_MODEL":42}}')).toBeUndefined();
    expect(splitEnvExtras('{"env":[]}')).toBeUndefined();
    expect(splitEnvExtras("not json {")).toBeUndefined();
  });

  it("读取并保存 Claude Code 的多模型映射，保留其他 settings 内容", () => {
    const mappings = readModelMappings('{"permissions":{"allow":["Read"]},"env":{"ANTHROPIC_MODEL":"main","ANTHROPIC_DEFAULT_OPUS_MODEL":"opus-gateway","CLAUDE_CODE_SUBAGENT_MODEL":"haiku-gateway","IGNORED":"keep"}}');
    expect(mappings).toMatchObject({
      ANTHROPIC_MODEL: "main",
      ANTHROPIC_DEFAULT_OPUS_MODEL: "opus-gateway",
      CLAUDE_CODE_SUBAGENT_MODEL: "haiku-gateway",
    });
    const patched = patchModelMappings('{"permissions":{"allow":["Read"]},"env":{"ANTHROPIC_MODEL":"main","IGNORED":"keep"}}', {
      ...mappings,
      ANTHROPIC_MODEL: "new-main",
      ANTHROPIC_DEFAULT_HAIKU_MODEL: "haiku-gateway",
    });
    expect(JSON.parse(patched)).toEqual({
      permissions: { allow: ["Read"] },
      env: {
        ANTHROPIC_MODEL: "new-main",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "haiku-gateway",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "opus-gateway",
        CLAUDE_CODE_SUBAGENT_MODEL: "haiku-gateway",
        IGNORED: "keep",
      },
    });
  });

  it("给每个模型 ID 添加或移除 Claude Code 的 1M 后缀", () => {
    expect(hasOneMillionModelSuffix("glm-5.3-flash[1m]")).toBe(true);
    expect(setOneMillionModelSuffix("glm-5.3-flash", true)).toBe("glm-5.3-flash[1M]");
    expect(setOneMillionModelSuffix("glm-5.3-flash[1m]", false)).toBe("glm-5.3-flash");
    expect(setOneMillionModelSuffix("", true)).toBe("");
  });

  it("读取和保存模型选择器显示名称，保留其他 env", () => {
    const raw = '{"env":{"ANTHROPIC_DEFAULT_SONNET_MODEL":"sonnet-gateway","ANTHROPIC_DEFAULT_SONNET_MODEL_NAME":"Sonnet 网关","KEEP":"keep"}}';
    const names = readModelDisplayNames(raw);
    expect(names.ANTHROPIC_DEFAULT_SONNET_MODEL_NAME).toBe("Sonnet 网关");
    const patched = patchModelDisplayNames(raw, { ...names, ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Sonnet 自定义" });
    expect(JSON.parse(patched)).toEqual({
      env: { ANTHROPIC_DEFAULT_SONNET_MODEL: "sonnet-gateway", ANTHROPIC_DEFAULT_SONNET_MODEL_NAME: "Sonnet 自定义", KEEP: "keep" },
    });
  });

  it("读取和保存 Claude Code 高级 env 字段，保留其他设置", () => {
    const raw = '{"env":{"DISABLE_AUTO_COMPACT":"1","KEEP":"keep"}}';
    expect(readEnvValue(raw, "DISABLE_AUTO_COMPACT")).toBe("1");
    const enabled = patchEnvValue(raw, "DISABLE_AUTO_COMPACT", null);
    expect(JSON.parse(enabled)).toEqual({ env: { KEEP: "keep" } });
    const configured = patchEnvValue(enabled, "CLAUDE_CODE_EFFORT_LEVEL", "max");
    expect(JSON.parse(configured)).toEqual({ env: { KEEP: "keep", CLAUDE_CODE_EFFORT_LEVEL: "max" } });
  });

  it("使用官方顶层 attribution 关闭提交和 PR 归属，并保留其他字段", () => {
    const raw = '{"model":"opus","attribution":{"sessionUrl":"https://claude.ai/code/session-x"},"env":{"KEEP":"keep"}}';
    expect(readGitAttributionDisabled(raw)).toBe(false);
    const disabled = patchGitAttribution(raw, true);
    expect(JSON.parse(disabled)).toEqual({
      model: "opus",
      attribution: { sessionUrl: "https://claude.ai/code/session-x", commit: "", pr: "" },
      env: { KEEP: "keep" },
    });
    expect(readGitAttributionDisabled(disabled)).toBe(true);
    expect(JSON.parse(patchGitAttribution(disabled, false))).toEqual({
      model: "opus",
      attribution: { sessionUrl: "https://claude.ai/code/session-x" },
      env: { KEEP: "keep" },
    });
  });

});
