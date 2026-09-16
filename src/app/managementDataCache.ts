import { api } from "../api";
import type { MarketplacePlugin, McpProbeResult, McpServerSpec, PluginMarketplace, PluginSummary, SkillSummary } from "../types";

export type McpProbeCacheEntry = {
  fingerprint: string;
  checkedAt: number;
  result: McpProbeResult;
  toolsLoaded: boolean;
};

type PersistedMcpProbeCacheEntry = Omit<McpProbeCacheEntry, "result"> & {
  result: Omit<McpProbeResult, "tools"> & { tools: string[] };
};

const MCP_PROBE_CACHE_STORAGE_KEY = "cgswitch.mcp-probe-cache";

/// 列表缓存从 localStorage 恢复时的最小形状校验：数组且每项含字符串 name 字段。
function restoreNamedList<T extends { name: string }>(raw: unknown): T[] | null {
  if (!Array.isArray(raw)) return null;
  if (raw.some((item) => typeof item !== "object" || item === null || typeof (item as { name?: unknown }).name !== "string")) return null;
  return raw as T[];
}

function createManagementCache<T>(loader: () => Promise<T>, persist?: { key: string; restore: (raw: unknown) => T | null }) {
  let cache: T | null = null;
  let request: Promise<T> | null = null;
  let restored = false;

  const restoreFromStorage = () => {
    if (restored || !persist) return;
    restored = true;
    if (typeof localStorage === "undefined") return;
    try {
      const raw = localStorage.getItem(persist.key);
      if (raw === null) return;
      cache = persist.restore(JSON.parse(raw));
    } catch {
      // 损坏或旧版本缓存只影响首开直出，进页静默刷新会纠正。
    }
  };

  const saveToStorage = (items: T) => {
    if (!persist || typeof localStorage === "undefined") return;
    try {
      localStorage.setItem(persist.key, JSON.stringify(items));
    } catch {
      // 本地存储不可用时保留内存缓存，当前操作仍可继续。
    }
  };

  return {
    load(force = false): Promise<T> {
      restoreFromStorage();
      if (force) cache = null;
      if (cache !== null) return Promise.resolve(cache);
      if (!request) {
        request = loader()
          .then((items) => {
            cache = items;
            saveToStorage(items);
            return items;
          })
          .finally(() => {
            request = null;
          });
      }
      return request;
    },
    get(): T | null {
      restoreFromStorage();
      return cache;
    },
    set(items: T): void {
      cache = items;
      saveToStorage(items);
    },
  };
}

const plugins = createManagementCache<PluginSummary[]>(api.listPlugins, {
  key: "cgswitch.plugins-cache-v1",
  restore: restoreNamedList<PluginSummary>,
});
const skills = createManagementCache<SkillSummary[]>(api.listSkills, {
  key: "cgswitch.skills-cache-v1",
  restore: restoreNamedList<SkillSummary>,
});
const mcpServers = createManagementCache<McpServerSpec[]>(api.listMcpServers);
const pluginMarketplaces = createManagementCache<PluginMarketplace[]>(api.listPluginMarketplaces, {
  key: "cgswitch.plugin-marketplaces-cache-v1",
  restore: restoreNamedList<PluginMarketplace>,
});
const mcpProbes = new Map<string, McpProbeCacheEntry>();
let mcpProbeStorageLoaded = false;

function compactMcpProbeResult(result: McpProbeResult): PersistedMcpProbeCacheEntry["result"] {
  const { tools, ...rest } = result;
  return { ...rest, tools: tools.map((tool) => tool.name) };
}

function restoreMcpProbeResult(result: PersistedMcpProbeCacheEntry["result"]): McpProbeResult {
  const { tools, ...rest } = result;
  return {
    ...rest,
    tools: tools
      .filter((name): name is string => typeof name === "string")
      .map((name) => ({ name, title: null, description: null, input_schema: {} })),
  };
}

function loadMcpProbeStorage(): void {
  if (mcpProbeStorageLoaded) return;
  mcpProbeStorageLoaded = true;
  if (typeof localStorage === "undefined") return;
  try {
    const stored = JSON.parse(localStorage.getItem(MCP_PROBE_CACHE_STORAGE_KEY) ?? "{}") as Record<string, PersistedMcpProbeCacheEntry>;
    for (const [name, entry] of Object.entries(stored)) {
      if (!entry || typeof entry.fingerprint !== "string" || !Array.isArray(entry.result?.tools)) continue;
      mcpProbes.set(name, { ...entry, result: restoreMcpProbeResult(entry.result) });
    }
  } catch {
    // 损坏或旧版本缓存只影响展示，不阻断 MCP 管理页。
  }
}

function persistMcpProbeStorage(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const stored = Object.fromEntries(
      [...mcpProbes].map(([name, entry]) => [name, { ...entry, result: compactMcpProbeResult(entry.result) }]),
    );
    localStorage.setItem(MCP_PROBE_CACHE_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // 本地存储不可用时保留内存缓存，当前操作仍可继续。
  }
}

export function loadPlugins(force = false): Promise<PluginSummary[]> {
  return plugins.load(force);
}

export function getCachedPluginMarketplaces(): PluginMarketplace[] | null {
  return pluginMarketplaces.get();
}

export function loadPluginMarketplaces(force = false): Promise<PluginMarketplace[]> {
  return pluginMarketplaces.load(force);
}

export function getCachedSkills(): SkillSummary[] | null {
  return skills.get();
}

export function loadSkills(force = false): Promise<SkillSummary[]> {
  return skills.load(force);
}

export function setSkillsCache(items: SkillSummary[]): void {
  skills.set(items);
}

export function loadMcpServers(force = false): Promise<McpServerSpec[]> {
  return mcpServers.load(force);
}

export function getCachedMcpServers(): McpServerSpec[] | null {
  return mcpServers.get();
}

export function setMcpServersCache(items: McpServerSpec[]): void {
  mcpServers.set(items);
}

export function getCachedMcpProbe(name: string, fingerprint: string): McpProbeCacheEntry | null {
  loadMcpProbeStorage();
  const entry = mcpProbes.get(name);
  return entry?.fingerprint === fingerprint ? entry : null;
}

export function setCachedMcpProbe(name: string, entry: McpProbeCacheEntry): void {
  loadMcpProbeStorage();
  mcpProbes.set(name, entry);
  persistMcpProbeStorage();
}

export function deleteCachedMcpProbe(name: string): void {
  loadMcpProbeStorage();
  if (mcpProbes.delete(name)) persistMcpProbeStorage();
}

// ==================== 市场插件目录缓存 ====================

/// 按市场名缓存目录快照：进入页面先显缓存，再静默刷新回填；请求按市场名去重。
const marketplacePlugins = new Map<string, MarketplacePlugin[]>();
const marketplaceRequests = new Map<string, Promise<MarketplacePlugin[]>>();

export function getCachedMarketplacePlugins(name: string): MarketplacePlugin[] | null {
  return marketplacePlugins.get(name) ?? null;
}

export function setCachedMarketplacePlugins(name: string, items: MarketplacePlugin[]): void {
  marketplacePlugins.set(name, items);
}

export function refreshMarketplacePlugins(name: string, root?: string): Promise<MarketplacePlugin[]> {
  const pending = marketplaceRequests.get(name);
  if (pending) return pending;
  const request = api
    .listMarketplacePlugins(name, root)
    .then((items) => {
      marketplacePlugins.set(name, items);
      return items;
    })
    .finally(() => {
      marketplaceRequests.delete(name);
    });
  marketplaceRequests.set(name, request);
  return request;
}
