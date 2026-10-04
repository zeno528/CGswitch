import { describe, expect, it, vi } from "vitest";
import { webInvoke } from "./web-mock";
import { extractClaudeCommonSettings, fillClaudeCommonSettings } from "../features/claude/profileEnvText";
import type { AppState, ClaudeProfileDetail, MarketplacePlugin, McpServerSpec, PluginMarketplace, PluginSkill, PluginSummary, PluginUpdate, CodexProfileDetail, CodexProfileSummary, SkillSummary } from "../types";

describe("web mock", () => {
  it.each(["codex", "claude"] as const)("%s 复制共用命名规则，每次副本紧跟源卡片", async (client) => {
    const list = async () => client === "codex"
      ? (await webInvoke<AppState>("get_state")).codex_profiles
      : await webInvoke<ClaudeProfileDetail[]>("claude_list_profiles");
    const profiles = await list();
    const source = profiles[0]!;
    const originalIds = profiles.map((profile) => profile.id);
    let timestamp = Date.now();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => ++timestamp);
    const copies: string[] = [];
    try {
      const first = await webInvoke<CodexProfileSummary>(`${client}_duplicate_profile`, { id: source.id });
      copies.push(first.id);
      const second = await webInvoke<CodexProfileSummary>(`${client}_duplicate_profile`, { id: source.id });
      copies.push(second.id);
      const base = [...source.name.trim()].slice(0, 45).join("");
      expect(first.name).toBe(`${base} copy`);
      expect(second.name).toBe(`${base} copy 2`);
      expect((await list()).map((profile) => profile.id)).toEqual([originalIds[0], second.id, first.id, ...originalIds.slice(1)]);
      if (client === "claude") expect((await webInvoke<ClaudeProfileDetail>("claude_get_profile", { id: second.id })).sort_order).toBe(1);
    } finally {
      for (const id of copies) await webInvoke(`${client}_delete_profile`, { id });
      clock.mockRestore();
    }
  });

  it("关闭的 MCP 编辑源码不包含应用开关状态", async () => {
    const fixture = (await webInvoke<McpServerSpec[]>("codex_list_mcp_servers"))[0];
    const name = "editor-disabled-fixture";
    try {
      await webInvoke("codex_save_mcp_server", { spec: { ...fixture, name } });
      await webInvoke("set_mcp_server_enabled", { name, tool: "codex", enabled: false });
      const source = await webInvoke<string>("codex_get_mcp_server_toml", { name });
      const server = (await webInvoke<McpServerSpec[]>("codex_list_mcp_servers")).find((item) => item.name === name)!;
      const patched = await webInvoke<string>("patch_mcp_fragment", { toml: source, spec: server });
      expect(patched).toBe(source);
      expect(patched).not.toContain("enabled = false");
    } finally {
      await webInvoke("codex_delete_mcp_server", { name });
    }
  });

  it.each([null, false, true])("MCP 编辑只保留源码的 enabled=%s，不写入列表开关状态", async (enabled) => {
    const source = `[mcp_servers.fixture]\nurl = "https://example.test/mcp"\n${enabled === null ? "" : `enabled = ${enabled}\n`}`;
    const spec = await webInvoke<McpServerSpec>("parse_mcp_fragment", { toml: source });
    const patched = await webInvoke<string>("patch_mcp_fragment", {
      toml: source, spec: { ...spec, enabled: enabled === false ? null : false, url: "https://example.test/updated" },
    });
    expect((await webInvoke<McpServerSpec>("parse_mcp_fragment", { toml: patched })).enabled).toBe(enabled);
    expect(patched).toContain('url = "https://example.test/updated"');
  });

  it("MCP 开关与卸载只影响所选客户端，共用编辑不重新安装另一端", async () => {
    const fixture = (await webInvoke<McpServerSpec[]>("codex_list_mcp_servers"))[0];
    for (const tool of ["codex", "claude"] as const) {
      const name = `uninstall-${tool}`;
      const list = tool === "codex" ? "codex_list_mcp_servers" : "claude_list_mcp_servers";
      const otherList = tool === "codex" ? "claude_list_mcp_servers" : "codex_list_mcp_servers";
      try {
        await webInvoke("codex_save_mcp_server", { spec: { ...fixture, name } });
        const other = await webInvoke<McpServerSpec[]>(otherList);
        await webInvoke("set_mcp_server_enabled", { name, tool, enabled: false });
        expect((await webInvoke<McpServerSpec[]>(list)).find((server) => server.name === name)?.enabled).toBe(false);
        expect(await webInvoke(otherList)).toEqual(other);
        await webInvoke(tool === "codex" ? "codex_delete_mcp_server" : "claude_delete_mcp_server", { name });
        expect((await webInvoke<McpServerSpec[]>(list)).some((server) => server.name === name)).toBe(false);
        expect(await webInvoke(otherList)).toEqual(other);
        if (tool === "claude") {
          await webInvoke("codex_save_mcp_server", { originalName: name, spec: { ...fixture, name, command: "updated" } });
        } else {
          await webInvoke("claude_save_mcp_server", { originalName: name, name, json: '{"type":"stdio","command":"updated"}' });
        }
        expect((await webInvoke<McpServerSpec[]>(list)).some((server) => server.name === name)).toBe(false);
      } finally {
        await webInvoke("codex_delete_mcp_server", { name });
        await webInvoke("claude_delete_mcp_server", { name });
      }
    }
  });

  it("共享重命名只改目标客户端的名称，保留配置全文及元数据", async () => {
    const created = await webInvoke<ClaudeProfileDetail>("claude_save_profile", {
      name: "rename-fixture", rawSettings: '{"env":{"CUSTOM":"keep"},"permissions":{"deny":["Write"]}}',
      description: "keep", icon: "custom", showBalance: true,
    });
    const codex = (await webInvoke<AppState>("get_state")).codex_profiles;
    try {
      await webInvoke("rename_profile", { id: created.id, name: "  renamed  ", tool: "claude" });
      const after = await webInvoke<ClaudeProfileDetail>("claude_get_profile", { id: created.id });
      expect(after).toEqual({ ...created, name: "renamed", updated_at: after.updated_at });
      expect((await webInvoke<AppState>("get_state")).codex_profiles).toEqual(codex);
      for (const name of [" ", "a".repeat(51)]) {
        await expect(webInvoke("rename_profile", { id: created.id, name, tool: "claude" })).rejects.toThrow("供应商名称长度");
      }
      await expect(webInvoke("rename_profile", { id: created.id, name: "wrong-client" })).rejects.toThrow("供应商配置不存在");
      expect(await webInvoke("claude_get_profile", { id: created.id })).toEqual(after);
    } finally {
      await webInvoke("claude_delete_profile", { id: created.id });
    }
  });

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
    const created = await webInvoke<CodexProfileSummary>("codex_add_custom_profile", { name: "Demo", description: "  First note  ", configText: 'model = "demo"' });
    try {
      expect(created).not.toHaveProperty("description");
      expect((await webInvoke<CodexProfileDetail>("codex_get_profile", { id: created.id })).description).toBe("First note");
      await webInvoke<CodexProfileSummary>("codex_update_profile", { id: created.id, name: "Demo", description: "Second note" });
      expect((await webInvoke<CodexProfileDetail>("codex_get_profile", { id: created.id })).description).toBe("Second note");
      await webInvoke<CodexProfileSummary>("codex_update_profile", { id: created.id, name: "Demo" });
      expect((await webInvoke<CodexProfileDetail>("codex_get_profile", { id: created.id })).description).toBe("Second note");
    } finally {
      await webInvoke("codex_delete_profile", { id: created.id });
    }
  });

  it("round-trips MCP env entries", async () => {
    const fragment = await webInvoke<string>("codex_get_mcp_server_toml", { name: "github" });
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

    // 使用中的配置不可删除（与后端守卫一致）：切换到别家后才能删
    await expect(webInvoke<void>("claude_delete_profile", { id: created.id })).rejects.toThrow("使用中");
    const other = await webInvoke<ClaudeProfileDetail>("claude_save_profile", { name: "临时配置二", baseUrl: "https://temp2.example", authToken: null, model: null });
    await webInvoke<void>("claude_apply_profile", { id: other.id });
    await webInvoke<void>("claude_delete_profile", { id: created.id });
    state = await webInvoke<AppState>("get_state");
    expect(state.active_claude_profile_id).toBe(other.id);
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
