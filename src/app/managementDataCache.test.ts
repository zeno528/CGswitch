import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listMcpServers } = vi.hoisted(() => ({ listMcpServers: vi.fn() }));
const persistedStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => persistedStorage.get(key) ?? null,
  setItem: (key: string, value: string) => persistedStorage.set(key, value),
};

vi.mock("../api", () => ({ api: { listMcpServers } }));

describe("managementDataCache", () => {
  beforeEach(() => {
    vi.resetModules();
    listMcpServers.mockReset();
    persistedStorage.clear();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("returns the cached MCP list when the management page remounts", async () => {
    const servers = [{ name: "github", command: "github-mcp-server", args: [], env: {}, enabled: null }];
    listMcpServers.mockResolvedValue(servers);
    const cache = await import("./managementDataCache");

    expect(cache.getCachedMcpServers()).toBeNull();
    await cache.loadMcpServers();
    await cache.loadMcpServers();

    expect(cache.getCachedMcpServers()).toEqual(servers);
    expect(listMcpServers).toHaveBeenCalledTimes(1);
  });

  it("shares MCP probe and tool results only for the same configuration", async () => {
    const cache = await import("./managementDataCache");
    const result = {
      ok: true,
      latency_ms: 1,
      status: 200,
      protocol_version: "2025-03-26",
      server_info: { name: "github", version: "1.0.0" },
      tools: [{ name: "search", title: null, description: null, input_schema: {} }],
      tools_truncated: false,
      error: null,
      tools_error: null,
    };

    cache.setCachedMcpProbe("github", { fingerprint: "v1", checkedAt: 1, result, toolsLoaded: true });

    expect(cache.getCachedMcpProbe("github", "v1")?.toolsLoaded).toBe(true);
    expect(cache.getCachedMcpProbe("github", "v2")).toBeNull();
  });

  it("persists only MCP tool names and restores them after a reload", async () => {
    const cache = await import("./managementDataCache");
    const result = {
      ok: true,
      latency_ms: 1,
      status: 200,
      protocol_version: "2025-03-26",
      server_info: { name: "github", version: "1.0.0" },
      tools: [{ name: "search", title: "Search", description: "large detail", input_schema: { query: "string" } }],
      tools_truncated: false,
      error: null,
      tools_error: null,
    };

    cache.setCachedMcpProbe("github", { fingerprint: "v1", checkedAt: 1, result, toolsLoaded: true });
    expect(JSON.parse(persistedStorage.get("cgswitch.mcp-probe-cache") ?? "{}").github.result.tools).toEqual(["search"]);

    vi.resetModules();
    const reloaded = await import("./managementDataCache");
    expect(reloaded.getCachedMcpProbe("github", "v1")?.result.tools.map((tool) => tool.name)).toEqual(["search"]);
  });
});
