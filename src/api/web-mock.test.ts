import { describe, expect, it } from "vitest";
import { webInvoke } from "./web-mock";
import type { MarketplacePlugin, PluginMarketplace, PluginSkill, PluginSummary, SkillSummary } from "../types";

describe("web mock", () => {
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

  it("keeps plugins and Codex skills in separate lists", async () => {
    const plugins = await webInvoke<PluginSummary[]>("list_plugins");
    const skills = await webInvoke<SkillSummary[]>("list_skills");
    const pluginSkills = await webInvoke<PluginSkill[]>("list_plugin_skills", { name: "memory-bank" });
    const marketplaces = await webInvoke<PluginMarketplace[]>("list_plugin_marketplaces");
    const marketplacePlugins = await webInvoke<MarketplacePlugin[]>("list_marketplace_plugins", { marketplace: "ponytail" });

    expect(plugins.every((plugin) => plugin.name !== "lark-base")).toBe(true);
    expect(marketplaces.find((marketplace) => marketplace.name === "youmind")?.source_url).toBe("https://github.com/YouMind-OpenLab/plugin-marketplace.git");
    expect(skills.map((skill) => skill.name)).toContain("lark-base");
    expect(pluginSkills.map((skill) => skill.name)).toContain("session-summary");
    expect(marketplaces.find((marketplace) => marketplace.name === "ponytail")?.kind).toBe("third-party");
    expect(marketplaces.find((marketplace) => marketplace.name === "ponytail")?.description).toContain("YAGNI");
    expect(marketplacePlugins.find((plugin) => plugin.name === "ponytail")?.installed).toBe(true);
    expect(marketplacePlugins.find((plugin) => plugin.name === "ponytail")?.description).toContain("smallest correct implementation");
  });
});
