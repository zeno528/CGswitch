// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { availableSkillCount, matchesSkillName } from "./SkillsView";

const viewSource = readFileSync(new URL("./SkillsView.tsx", import.meta.url), "utf8");

describe("availableSkillCount", () => {
  it("统计已管理 Skill 的更新", () => {
    expect(availableSkillCount([
      { name: "new-skill", description: null, store_path: "/tmp/new", source: "Codex", has_content_conflict: false, is_update: false, modified_at: 0 },
      { name: "updated-skill", description: null, store_path: "/tmp/updated", source: "Codex", has_content_conflict: false, is_update: true, modified_at: 0 },
    ])).toBe(2);
  });

  it("统计可导入的新 Skill", () => {
    expect(availableSkillCount([
      { name: "new-skill", description: null, store_path: "/tmp/new", source: "Agent", has_content_conflict: false, is_update: false, modified_at: 0 },
    ])).toBe(1);
  });

  it("进入导入页复用已扫描的候选列表，不重复展示扫描加载态", () => {
    expect(viewSource).toContain("const availableCount = availableSkillCount(candidates);");
    expect(viewSource).toContain("if (candidates.length) return;");
    expect(viewSource).toContain("try { setCandidates(await api.scanUnmanagedSkills()); }");
  });
});

describe("matchesSkillName", () => {
  it("仅按 Skill 名称过滤，忽略大小写和首尾空格", () => {
    const skill = { name: "Ponytail", description: "精简实现工作流", enabled: true };
    expect(matchesSkillName(skill, " pony ")).toBe(true);
    expect(matchesSkillName(skill, "workflow")).toBe(false);
  });
});

describe("availableCount 刷新时机", () => {
  it("导入与删除成功后立即重扫候选，角标不等窗口重新聚焦", () => {
    // 导入和删除都会改变候选集；两处 refresh(true) 后必须跟 scanForUpdates()（同行或换行注释均可）
    const callSites = viewSource.match(/await refresh\(true\);\s*(?:\/\/[^\n]*\n\s*)?void scanForUpdates\(\);/g) ?? [];
    expect(callSites).toHaveLength(2);
  });
});
