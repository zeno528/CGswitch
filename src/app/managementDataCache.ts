import { api } from "../api";
import type { ClaudeProfileSummary, DatabaseBackupInfo, MarketplacePlugin, McpProbeResult, McpServerSpec, PluginMarketplace, PluginSummary, SkillSummary } from "../types";

export type McpProbeCacheEntry = {
  fingerprint: string;
  result: McpProbeResult;
  toolsLoaded: boolean;
};

export type McpProbeScope = "codex" | "claude";

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

/// localStorage JSON 读写统一管道：SSR/隐私模式降级为空，损坏缓存视为不存在。
function readJson(key: string): unknown {
  if (typeof localStorage === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null");
  } catch {
    return null; // 损坏或旧版本缓存只影响首开直出，进页静默刷新会纠正。
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 本地存储不可用时保留内存缓存，当前操作仍可继续。
  }
}

function createManagementCache<T>(loader: () => Promise<T>, persist?: { key: string; restore: (raw: unknown) => T | null }) {
  let cache: T | null = null;
  let request: Promise<T> | null = null;
  let restored = false;

  const restoreFromStorage = () => {
    if (restored || !persist) return;
    restored = true;
    const raw = readJson(persist.key);
    if (raw !== null) cache = persist.restore(raw);
  };

  const saveToStorage = (items: T) => {
    if (!persist) return;
    writeJson(persist.key, items);
  };

  return {
    load(force = false): Promise<T> {
      restoreFromStorage();
      // force 不抹缓存：绕过快路径、后台去重取新，取回前旧值照常直出。抹缓存会
      // 制造「强刷在途 + 内存为空」窗口，而 restored 一次性标记挡住 localStorage，
      // 窗口期内切页再回来只能对着在途请求转圈。
      if (cache !== null && !force) return Promise.resolve(cache);
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
  key: "cgswitch.skills-cache-v2", // v2：SkillSummary 增加 claude_enabled，旧缓存缺字段直接弃用
  restore: restoreNamedList<SkillSummary>,
});
const mcpServers = createManagementCache<McpServerSpec[]>(api.codexListMcpServers, {
  key: "cgswitch.mcp-servers-cache-v1",
  restore: restoreNamedList<McpServerSpec>,
});
const claudeMcpServers = createManagementCache<McpServerSpec[]>(api.claudeListMcpServers, {
  key: "cgswitch.claude-mcp-servers-cache-v1",
  restore: restoreNamedList<McpServerSpec>,
});
/// Claude 供应商列表可持久化：摘要里只有 has_token 布尔，明文 token 不进缓存。
const claudeProfiles = createManagementCache<ClaudeProfileSummary[]>(api.claudeListProfiles, {
  key: "cgswitch.claude-profiles-cache-v1",
  restore: restoreNamedList<ClaudeProfileSummary>,
});
const pluginMarketplaces = createManagementCache<PluginMarketplace[]>(api.listPluginMarketplaces, {
  key: "cgswitch.plugin-marketplaces-cache-v1",
  restore: restoreNamedList<PluginMarketplace>,
});
// 备份记录列表：只在内存缓存（不落 localStorage）——设置页切分页重挂载时直出，
// 避免先闪"还没有备份记录"空态；跨重启的首开由进页静默刷新立刻补齐。
const databaseBackups = createManagementCache<DatabaseBackupInfo[]>(api.listDatabaseBackups);
export type ProxyStatus = { proxy: string | null; error: boolean };
// 同样只放内存，切设置分区时直出上次结果；读取失败也保留为稳定的状态。
const proxyStatus = createManagementCache<ProxyStatus>(async () => {
  try {
    return { proxy: await api.getProxyStatus(), error: false };
  } catch {
    return { proxy: null, error: true };
  }
});
const mcpProbes = new Map<string, McpProbeCacheEntry>();
let mcpProbeStorageLoaded = false;

function mcpProbeCacheKey(name: string, scope: McpProbeScope): string {
  return scope === "codex" ? name : `\u0000${scope}\u0000${name}`;
}

function restoreMcpProbeCacheKey(key: string): string {
  const prefix = "\u0000claude\u0000";
  return key.startsWith(prefix) ? key : mcpProbeCacheKey(key, "codex");
}

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
  const stored = readJson(MCP_PROBE_CACHE_STORAGE_KEY);
  if (stored === null || typeof stored !== "object") return;
  for (const [name, entry] of Object.entries(stored as Record<string, PersistedMcpProbeCacheEntry>)) {
    if (!entry || typeof entry.fingerprint !== "string" || !Array.isArray(entry.result?.tools)) continue;
    mcpProbes.set(restoreMcpProbeCacheKey(name), { ...entry, result: restoreMcpProbeResult(entry.result) });
  }
}

function persistMcpProbeStorage(): void {
  const stored = Object.fromEntries(
    [...mcpProbes].map(([name, entry]) => [name, { ...entry, result: compactMcpProbeResult(entry.result) }]),
  );
  writeJson(MCP_PROBE_CACHE_STORAGE_KEY, stored);
}

export function loadPlugins(force = false): Promise<PluginSummary[]> {
  return plugins.load(force);
}

export function getCachedPlugins(): PluginSummary[] | null {
  return plugins.get();
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

export function setClaudeMcpServersCache(items: McpServerSpec[]): void {
  claudeMcpServers.set(items);
}

export function loadClaudeMcpServers(force = false): Promise<McpServerSpec[]> {
  return claudeMcpServers.load(force);
}

export function getCachedClaudeMcpServers(): McpServerSpec[] | null {
  return claudeMcpServers.get();
}

export function loadClaudeProfiles(force = false): Promise<ClaudeProfileSummary[]> {
  return claudeProfiles.load(force);
}

export function getCachedClaudeProfiles(): ClaudeProfileSummary[] | null {
  return claudeProfiles.get();
}

export function setClaudeProfilesCache(items: ClaudeProfileSummary[]): void {
  claudeProfiles.set(items);
}

export function loadProxyStatus(force = false): Promise<ProxyStatus> {
  return proxyStatus.load(force);
}

export function getCachedProxyStatus(): ProxyStatus | null {
  return proxyStatus.get();
}

export function loadDatabaseBackups(force = false): Promise<DatabaseBackupInfo[]> {
  return databaseBackups.load(force);
}

export function getCachedDatabaseBackups(): DatabaseBackupInfo[] | null {
  return databaseBackups.get();
}

// ==================== MCP 差异角标（侧栏 + MCP 页） ====================

/// 角标两态：`count` 项可逐条处理的差异，或 `error`（config.toml 解析不了，差异
/// 根本算不出来）。两态共用一条通道是刻意的——"配置坏了"跟"有差异"一样是用户
/// 不点进 MCP 页就看不见的状况，必须搭同一班车到侧栏。
/// MCP 页查完写回，侧栏首屏读缓存直出；侧栏自己不发起查询（差异查询实测 0.5ms
/// 级，但仍不进启动关键路径，见 AppShell 的延迟刷新）。
export interface McpDiffBadge {
  count: number;
  error: boolean;
}

const MCP_DIFF_COUNT_STORAGE_KEY = "cgswitch.mcp-diff-count-v1";
let mcpDiffBadge: McpDiffBadge | null = null;
let mcpDiffBadgeRestored = false;
const mcpDiffBadgeListeners = new Set<() => void>();

/// 返回的必须是稳定引用（存下来的那个对象），否则 useSyncExternalStore 会无限重渲染。
export function getMcpDiffBadge(): McpDiffBadge | null {
  if (!mcpDiffBadgeRestored) {
    mcpDiffBadgeRestored = true;
    const raw = readJson(MCP_DIFF_COUNT_STORAGE_KEY);
    if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) mcpDiffBadge = { count: raw, error: false };
  }
  return mcpDiffBadge;
}

/// 角标文本：有差异显示数量（>9 折成 9+），差异算不出来显示 `!`，都没有则不显示。
/// 侧栏与 MCP 页头共用这一条规则——同一个状态在两处必须长一样，分家就会一边 9+
/// 一边 128，或者一边 `!` 一边数字。
export function mcpDiffBadgeText(badge: McpDiffBadge | null): string | null {
  if (!badge) return null;
  if (badge.count > 0) return badge.count > 9 ? "9+" : String(badge.count);
  return badge.error ? "!" : null;
}

export function setMcpDiffBadge(next: McpDiffBadge): void {
  if (mcpDiffBadge && mcpDiffBadge.count === next.count && mcpDiffBadge.error === next.error) return;
  mcpDiffBadge = next;
  writeJson(MCP_DIFF_COUNT_STORAGE_KEY, next.count);
  for (const listener of mcpDiffBadgeListeners) listener();
}

export function subscribeMcpDiffBadge(listener: () => void): () => void {
  mcpDiffBadgeListeners.add(listener);
  return () => {
    mcpDiffBadgeListeners.delete(listener);
  };
}

export function getCachedMcpProbe(name: string, fingerprint: string, scope: McpProbeScope = "codex"): McpProbeCacheEntry | null {
  loadMcpProbeStorage();
  const entry = mcpProbes.get(mcpProbeCacheKey(name, scope));
  return entry?.fingerprint === fingerprint ? entry : null;
}

export function setCachedMcpProbe(name: string, entry: McpProbeCacheEntry, scope: McpProbeScope = "codex"): void {
  loadMcpProbeStorage();
  mcpProbes.set(mcpProbeCacheKey(name, scope), entry);
  persistMcpProbeStorage();
}

export function deleteCachedMcpProbe(name: string, scope: McpProbeScope = "codex"): void {
  loadMcpProbeStorage();
  if (mcpProbes.delete(mcpProbeCacheKey(name, scope))) persistMcpProbeStorage();
}

// ==================== 市场插件目录缓存 ====================

/// 按市场名缓存目录快照：进入页面先显缓存，再静默刷新回填；请求按市场名去重。
/// 快照持久化到 localStorage（模式同 MCP 探测缓存：会话加载一次、写入即落盘），
/// 重启后首次进入市场页/目录详情才能直出，不用每个市场重新转圈；超配额时
/// writeJson 静默降级为纯内存缓存。
const MARKETPLACE_PLUGINS_STORAGE_KEY = "cgswitch.marketplace-plugins-cache-v1";
const marketplacePlugins = new Map<string, MarketplacePlugin[]>();
const marketplaceRequests = new Map<string, Promise<MarketplacePlugin[]>>();
let marketplacePluginsStorageLoaded = false;

function loadMarketplacePluginsStorage(): void {
  if (marketplacePluginsStorageLoaded) return;
  marketplacePluginsStorageLoaded = true;
  const stored = readJson(MARKETPLACE_PLUGINS_STORAGE_KEY);
  if (stored === null || typeof stored !== "object") return;
  for (const [name, items] of Object.entries(stored as Record<string, unknown>)) {
    const restored = restoreNamedList<MarketplacePlugin>(items);
    if (restored) marketplacePlugins.set(name, restored);
  }
}

function persistMarketplacePluginsStorage(): void {
  writeJson(MARKETPLACE_PLUGINS_STORAGE_KEY, Object.fromEntries(marketplacePlugins));
}

export function getCachedMarketplacePlugins(name: string): MarketplacePlugin[] | null {
  loadMarketplacePluginsStorage();
  return marketplacePlugins.get(name) ?? null;
}

export function setCachedMarketplacePlugins(name: string, items: MarketplacePlugin[]): void {
  loadMarketplacePluginsStorage();
  marketplacePlugins.set(name, items);
  persistMarketplacePluginsStorage();
}

export function refreshMarketplacePlugins(name: string, root?: string): Promise<MarketplacePlugin[]> {
  loadMarketplacePluginsStorage();
  const pending = marketplaceRequests.get(name);
  if (pending) return pending;
  const request = api
    .listMarketplacePlugins(name, root)
    .then((items) => {
      setCachedMarketplacePlugins(name, items);
      return items;
    })
    .finally(() => {
      marketplaceRequests.delete(name);
    });
  marketplaceRequests.set(name, request);
  return request;
}
