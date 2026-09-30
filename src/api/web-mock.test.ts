import { describe, expect, it } from "vitest";
import { webInvoke } from "./web-mock";
import { extractClaudeCommonSettings, fillClaudeCommonSettings } from "../features/claude/profileEnvText";
import type { AppState, ClaudeProfileDetail, MarketplacePlugin, PluginMarketplace, PluginSkill, PluginSummary, PluginUpdate, ProfileDetail, ProfileSummary, SkillSummary } from "../types";

describe("web mock", () => {
  it("官方 API 配置从全文回显 API Key", async () => {
    const rawSettings = '{"env":{"ANTHROPIC_API_KEY":"fixture-key"}}';
    const created = await webInvoke<ClaudeProfileDetail>("claude_save_profile", {
      name: "fixture-api", kind: "anthropic", rawSettings,
    });
    try {
      expect(created.auth_token).toBe("fixture-key");
      expect(created.raw_settings).toBe(rawSettings);
    } finally {
      await webInvoke("claude_delete_profile", { id: created.id });
    }
  });

  it("编辑先读取已保存模板，提取与取消不写库，保存后填充使用新版本", async () => {
    const previous = await webInvoke<string | null>("claude_get_common_settings");
    const saved = '{"hooks":{"Stop":[{"command":"old"}]},"env":{"CUSTOM":"old"}}';
    try {
      await webInvoke("claude_save_common_settings", { text: saved });
      const opened = await webInvoke<string>("claude_get_common_settings");
      expect(opened).toBe(saved);
      const source = '{"hooks":{"Stop":[{"command":"new"}]},"env":{"CUSTOM":"new","ANTHROPIC_AUTH_TOKEN":"private"}}';
      const draft = extractClaudeCommonSettings(source)!;
      expect(JSON.parse(draft)).toEqual({ hooks: { Stop: [{ command: "new" }] }, env: { CUSTOM: "new" } });
      // 提取只更新预览；关闭弹窗前数据库仍是旧版本，外面的填充仍使用旧模板。
      await expect(webInvoke("claude_get_common_settings")).resolves.toBe(saved);
      expect(JSON.parse(fillClaudeCommonSettings("{}", opened)!)).toEqual(JSON.parse(saved));
      await webInvoke("claude_save_common_settings", { text: draft });
      const next = await webInvoke<string>("claude_get_common_settings");
      expect(next).toBe(draft);
      const filled = fillClaudeCommonSettings('{"env":{"ANTHROPIC_AUTH_TOKEN":"current"}}', next)!;
      expect(JSON.parse(filled)).toEqual({ hooks: { Stop: [{ command: "new" }] }, env: { ANTHROPIC_AUTH_TOKEN: "current", CUSTOM: "new" } });
    } finally {
      await webInvoke("claude_save_common_settings", { text: previous });
    }
  });
  it("保存通用模板时拒绝非法内容，且不修改供应商或激活状态", async () => {
    const before = await webInvoke<AppState>("get_state");
    const profiles = await webInvoke<ClaudeProfileDetail[]>("claude_list_profiles");
    const template = '{"hooks":{"Stop":[]},"env":{"CUSTOM":"keep"}}';
    try {
      await webInvoke("claude_save_common_settings", { text: template });
      await expect(webInvoke("claude_get_common_settings")).resolves.toBe(template);
      await expect(webInvoke("claude_save_common_settings", { text: '{"env":{"CUSTOM":42}}' })).rejects.toThrow();
      await expect(webInvoke("claude_get_common_settings")).resolves.toBe(template);
      await expect(webInvoke("claude_list_profiles")).resolves.toEqual(profiles);
      expect((await webInvoke<AppState>("get_state")).active_claude_profile_id).toBe(before.active_claude_profile_id);
    } finally {
      await webInvoke("claude_save_common_settings", { text: null });
    }
    await expect(webInvoke("claude_get_common_settings")).resolves.toBeNull();
  });
  it("keeps a provider description across create, edit and detail reads", async () => {
    const created = await webInvoke<ProfileSummary>("add_custom_profile", { name: "Demo", description: "  First note  ", configText: 'model = "demo"' });
    try {
      expect(created).not.toHaveProperty("description");
      expect((await webInvoke<ProfileDetail>("get_profile", { id: created.id })).description).toBe("First note");
      await webInvoke<ProfileSummary>("update_profile", { id: created.id, name: "Demo", description: "Second note" });
      expect((await webInvoke<ProfileDetail>("get_profile", { id: created.id })).description).toBe("Second note");
      await webInvoke<ProfileSummary>("update_profile", { id: created.id, name: "Demo" });
      expect((await webInvoke<ProfileDetail>("get_profile", { id: created.id })).description).toBe("Second note");
    } finally {
      await webInvoke("delete_profile", { id: created.id });
    }
  });

  it("round-trips MCP env entries", async () => {
    const fragment = await webInvoke<string>("get_mcp_server_toml", { name: "github" });
    const spec = await webInvoke<{ env: Record<string, string> }>("parse_mcp_fragment", { toml: fragment });

    expect(spec.env).toEqual({ GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_demo" });
  });

  it("rejects MCP server names containing dots", async () => {
    await expect(
      webInvoke("parse_mcp_fragment", { toml: '[mcp_servers.a.b]\nurl = "https://example.com"' }),
    ).rejects.toThrow("片段中没有服务器");
  });

  it("passes format_toml input through in web mode", async () => {
    const text = 'model = "demo"';
    await expect(webInvoke("format_toml", { text })).resolves.toBe(text);
  });

  it("returns managed Skill content for preview", async () => {
    await expect(webInvoke<string>("get_skill_content", { name: "lark-base" })).resolves.toContain("# lark-base");
  });

  it("toggles per-tool skill distribution independently", async () => {
    await webInvoke<void>("enable_skill", { name: "lark-base", tool: "claude" });
    let skills = await webInvoke<SkillSummary[]>("list_skills");
    expect(skills.find((skill) => skill.name === "lark-base")).toMatchObject({ enabled: true, claude_enabled: true });

    await webInvoke<void>("disable_skill", { name: "lark-base", tool: "codex" });
    skills = await webInvoke<SkillSummary[]>("list_skills");
    expect(skills.find((skill) => skill.name === "lark-base")).toMatchObject({ enabled: false, claude_enabled: true });
  });

  it("keeps claude provider save/apply/delete stateful in web mode", async () => {
    const created = await webInvoke<ClaudeProfileDetail>("claude_save_profile", { name: "临时配置", baseUrl: "https://temp.example", authToken: null, model: null });
    expect(created.id).toContain("cla-web-");
    expect(created.base_url).toBe("https://temp.example");

    await webInvoke<void>("claude_apply_profile", { id: created.id });
    let state = await webInvoke<AppState>("get_state");
    expect(state.active_claude_profile_id).toBe(created.id);

    await webInvoke<void>("claude_delete_profile", { id: created.id });
    state = await webInvoke<AppState>("get_state");
    expect(state.active_claude_profile_id).toBeNull();
    await expect(webInvoke<ClaudeProfileDetail>("claude_get_profile", { id: created.id })).rejects.toThrow("不存在");
  });

  it("captures a Claude provider without activating it in web mode", async () => {
    const before = (await webInvoke<AppState>("get_state")).active_claude_profile_id;
    const captured = await webInvoke<ClaudeProfileDetail>("claude_capture_profile", { name: "当前配置" });
    expect(captured.name).toBe("当前配置");
    expect(JSON.parse(captured.raw_settings!)).toMatchObject({ model: "sonnet", env: { ANTHROPIC_BASE_URL: "https://relay.example/v1" } });
    expect((await webInvoke<AppState>("get_state")).active_claude_profile_id).toBe(before);
    await webInvoke<void>("claude_delete_profile", { id: captured.id });
  });

  it("keeps plugins and Codex skills in separate lists", async () => {
    const plugins = await webInvoke<PluginSummary[]>("list_plugins");
    const skills = await webInvoke<SkillSummary[]>("list_skills");
    const pluginSkills = await webInvoke<PluginSkill[]>("list_plugin_skills", { name: "memory-bank", storePath: "C:\\Users\\<user>\\.codex\\plugins\\cache\\memory-bank" });
    const marketplaces = await webInvoke<PluginMarketplace[]>("list_plugin_marketplaces");
    const marketplacePlugins = await webInvoke<MarketplacePlugin[]>("list_marketplace_plugins", { marketplace: "ponytail" });

    expect(plugins.every((plugin) => plugin.name !== "lark-base")).toBe(true);
    expect(plugins.find((plugin) => plugin.name === "ponytail")?.source_url).toBe("https://github.com/DietrichGebert/ponytail.git");
    expect(marketplaces.find((marketplace) => marketplace.name === "youmind")?.source_url).toBe("https://github.com/YouMind-OpenLab/plugin-marketplace.git");
    expect(skills.map((skill) => skill.name)).toContain("lark-base");
    expect(pluginSkills.map((skill) => skill.name)).toContain("session-summary");
    expect(marketplaces.find((marketplace) => marketplace.name === "ponytail")?.kind).toBe("third-party");
    expect(marketplaces.find((marketplace) => marketplace.name === "ponytail")?.description).toContain("YAGNI");
    expect(marketplacePlugins.find((plugin) => plugin.name === "ponytail")?.installed).toBe(true);
    expect(marketplacePlugins.find((plugin) => plugin.name === "ponytail")?.description).toContain("smallest correct implementation");
  });

  it("checks and upgrades only a third-party marketplace plugin", async () => {
    const updates = await webInvoke<PluginUpdate[]>("check_plugin_updates");

    expect(updates).toEqual([{ name: "ponytail", marketplace: "ponytail", version: "5.0.0" }]);

    await expect(webInvoke<void>("upgrade_marketplace_plugin", { marketplace: "ponytail", name: "ponytail" })).resolves.toBeUndefined();

    expect((await webInvoke<PluginSummary[]>("list_plugins")).find((plugin) => plugin.name === "ponytail")?.version).toBe("5.0.0");
  });
});
