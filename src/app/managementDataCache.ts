import { api } from "../api";
import type { McpProbeResult, McpServerSpec, PluginSummary, SkillSummary } from "../types";

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

function createManagementCache<T>(loader: () => Promise<T>) {
  let cache: T | null = null;
  let request: Promise<T> | null = null;

  return {
    load(force = false): Promise<T> {
      if (force) cache = null;
      if (cache !== null) return Promise.resolve(cache);
      if (!request) {
        request = loader()
          .then((items) => {
            cache = items;
            return items;
          })
          .finally(() => {
            request = null;
          });
      }
      return request;
    },
    get(): T | null {
      return cache;
    },
    set(items: T): void {
      cache = items;
    },
  };
}

const plugins = createManagementCache<PluginSummary[]>(api.listPlugins);
const skills = createManagementCache<SkillSummary[]>(api.listSkills);
const mcpServers = createManagementCache<McpServerSpec[]>(api.listMcpServers);
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
