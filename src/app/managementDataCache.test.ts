import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listMcpServers, listMarketplacePlugins, listPlugins } = vi.hoisted(() => ({
  listMcpServers: vi.fn(),
  listMarketplacePlugins: vi.fn(),
  listPlugins: vi.fn(),
}));
const persistedStorage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => persistedStorage.get(key) ?? null,
  setItem: (key: string, value: string) => persistedStorage.set(key, value),
};

vi.mock("../api", () => ({ api: { listMcpServers, listMarketplacePlugins, listPlugins } }));

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

    cache.setCachedMcpProbe("github", { fingerprint: "v1", result, toolsLoaded: true });

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

    cache.setCachedMcpProbe("github", { fingerprint: "v1", result, toolsLoaded: true });
    expect(JSON.parse(persistedStorage.get("cgswitch.mcp-probe-cache") ?? "{}").github.result.tools).toEqual(["search"]);

    vi.resetModules();
    const reloaded = await import("./managementDataCache");
    expect(reloaded.getCachedMcpProbe("github", "v1")?.result.tools.map((tool) => tool.name)).toEqual(["search"]);
  });
});

describe("marketplace plugin catalog cache", () => {
  beforeEach(() => {
    vi.resetModules();
    listMarketplacePlugins.mockReset();
  });

  const plugin = (name: string) => ({
    plugin_id: `${name}@fixture`,
    name,
    version: "1.0.0",
    installed: false,
    auth_policy: "ON_USE",
    source: null,
    display_name: null,
    description: null,
    category: null,
    capabilities: [],
    contains: [],
  });

  it("caches the catalog after a refresh and serves later reads from cache", async () => {
    const catalog = [plugin("a")];
    listMarketplacePlugins.mockResolvedValue(catalog);
    const cache = await import("./managementDataCache");

    expect(cache.getCachedMarketplacePlugins("market-a")).toBeNull();
    const items = await cache.refreshMarketplacePlugins("market-a");
    expect(cache.getCachedMarketplacePlugins("market-a")).toBe(items);
    expect(listMarketplacePlugins).toHaveBeenCalledWith("market-a", undefined);
  });

  it("deduplicates concurrent refreshes for the same marketplace", async () => {
    listMarketplacePlugins.mockReturnValue(new Promise(() => {}));
    const cache = await import("./managementDataCache");

    const first = cache.refreshMarketplacePlugins("market-dup");
    const second = cache.refreshMarketplacePlugins("market-dup");
    expect(first).toBe(second);
    expect(listMarketplacePlugins).toHaveBeenCalledTimes(1);
  });

  it("clears the in-flight request on failure so the next entry can retry", async () => {
    listMarketplacePlugins.mockRejectedValueOnce(new Error("cli failed"));
    const cache = await import("./managementDataCache");

    await expect(cache.refreshMarketplacePlugins("market-err")).rejects.toThrow("cli failed");
    expect(cache.getCachedMarketplacePlugins("market-err")).toBeNull();

    listMarketplacePlugins.mockResolvedValueOnce([]);
    await expect(cache.refreshMarketplacePlugins("market-err")).resolves.toEqual([]);
  });
});

describe("list cache persistence", () => {
  beforeEach(() => {
    vi.resetModules();
    listPlugins.mockReset();
    persistedStorage.clear();
    vi.stubGlobal("localStorage", localStorageMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  const plugin = { name: "ponytail", version: "1.0.0", enabled: true };

  it("persists the plugins cache and restores it after a module reload", async () => {
    listPlugins.mockResolvedValue([plugin]);
    const cache = await import("./managementDataCache");
    await cache.loadPlugins();
    expect(persistedStorage.get("cgswitch.plugins-cache-v1")).toContain("ponytail");

    vi.resetModules();
    const reloaded = await import("./managementDataCache");
    await expect(reloaded.loadPlugins()).resolves.toEqual([plugin]);
    expect(listPlugins).toHaveBeenCalledTimes(1); // 重载后命中持久化缓存，不再发请求
  });

  it("ignores corrupt persisted caches and falls back to a fresh load", async () => {
    persistedStorage.set("cgswitch.plugins-cache-v1", "{not-json");
    const cache = await import("./managementDataCache");
    listPlugins.mockResolvedValue([plugin]);

    await expect(cache.loadPlugins()).resolves.toEqual([plugin]);
    expect(listPlugins).toHaveBeenCalledTimes(1);
  });

  it("rejects persisted snapshots whose entries lack a string name", async () => {
    persistedStorage.set("cgswitch.plugins-cache-v1", JSON.stringify([{ version: "1.0.0" }]));
    const cache = await import("./managementDataCache");
    listPlugins.mockResolvedValue([plugin]);

    await expect(cache.loadPlugins()).resolves.toEqual([plugin]);
    expect(listPlugins).toHaveBeenCalledTimes(1);
  });

  it("keeps stale cache readable while a forced refresh is in flight", async () => {
    listPlugins.mockResolvedValueOnce([plugin]);
    const cache = await import("./managementDataCache");
    await cache.loadPlugins();

    // 强刷挂起（模拟慢扫盘）：期间普通读取必须直出旧缓存，不能转圈等请求
    listPlugins.mockReturnValueOnce(new Promise(() => {}));
    void cache.loadPlugins(true);
    await expect(cache.loadPlugins()).resolves.toEqual([plugin]);
    expect(cache.getCachedPlugins()).toEqual([plugin]);
  });

  it("shares the in-flight request between a cold load and a forced refresh", async () => {
    listPlugins.mockReturnValueOnce(new Promise(() => {}));
    const cache = await import("./managementDataCache");

    const cold = cache.loadPlugins();
    expect(cache.loadPlugins(true)).toBe(cold);
    expect(listPlugins).toHaveBeenCalledTimes(1);
  });
});
