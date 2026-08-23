import { api } from "../api";
import type { McpServerSpec, PluginSummary, SkillSummary } from "../types";

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
