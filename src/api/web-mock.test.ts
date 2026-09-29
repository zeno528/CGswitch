import { describe, expect, it } from "vitest";
import { webInvoke } from "./web-mock";
import type { AppState, ClaudeProfileDetail, MarketplacePlugin, PluginMarketplace, PluginSkill, PluginSummary, PluginUpdate, ProfileDetail, ProfileSummary, SkillSummary } from "../types";

describe("web mock", () => {
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
