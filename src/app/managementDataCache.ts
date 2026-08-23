import { api } from "../api";
import type { PluginSummary, SkillSummary } from "../types";

let pluginsCache: PluginSummary[] | null = null;
let pluginsRequest: Promise<PluginSummary[]> | null = null;
let skillsCache: SkillSummary[] | null = null;
let skillsRequest: Promise<SkillSummary[]> | null = null;

export function loadPlugins(force = false): Promise<PluginSummary[]> {
  if (force) pluginsCache = null;
  if (pluginsCache !== null) return Promise.resolve(pluginsCache);
  if (!pluginsRequest) {
    pluginsRequest = api.listPlugins()
      .then((items) => {
        pluginsCache = items;
        return items;
      })
      .finally(() => {
        pluginsRequest = null;
      });
  }
  return pluginsRequest;
}

export function loadSkills(force = false): Promise<SkillSummary[]> {
  if (force) skillsCache = null;
  if (skillsCache !== null) return Promise.resolve(skillsCache);
  if (!skillsRequest) {
    skillsRequest = api.listSkills()
      .then((items) => {
        skillsCache = items;
        return items;
      })
      .finally(() => {
        skillsRequest = null;
      });
  }
  return skillsRequest;
}

export function setSkillsCache(items: SkillSummary[]): void {
  skillsCache = items;
}
