import { beforeEach, describe, expect, it, vi } from "vitest";

const { listMcpServers } = vi.hoisted(() => ({ listMcpServers: vi.fn() }));

vi.mock("../api", () => ({ api: { listMcpServers } }));

describe("managementDataCache", () => {
  beforeEach(() => {
    vi.resetModules();
    listMcpServers.mockReset();
  });

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
});
