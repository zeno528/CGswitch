// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { selectableSkillPaths } from "./SkillsView";

const viewSource = readFileSync(new URL("./SkillsView.tsx", import.meta.url), "utf8");

describe("Skill 导入入口", () => {
  it("进入导入页复用已扫描的候选列表，不重复展示扫描加载态", () => {
    expect(viewSource).toContain("const availableCount = candidates.length;");
    expect(viewSource).toContain("if (candidates.length) return;");
    expect(viewSource).toContain("try { setCandidates(await api.scanUnmanagedSkills()); }");
  });
});

describe("Skill 批量导入", () => {
  it("只批量导入无内容冲突项，冲突项留给单项操作", () => {
    expect(selectableSkillPaths([
      { name: "new-skill", description: null, store_path: "/tmp/new", source: "Agent", has_content_conflict: false, is_update: false, modified_at: 0 },
      { name: "conflict-skill", description: null, store_path: "/tmp/conflict", source: "Agent", has_content_conflict: true, is_update: false, modified_at: 0 },
    ])).toEqual(["/tmp/new"]);
    expect(viewSource).toContain("const importablePaths = selectableSkillPaths(visibleCandidates);");
    expect(viewSource).not.toContain("selectedPaths");
  });
});

describe("Skill 标题栏", () => {
  it("复用 MCP 和插件页的可换行标题栏结构，避免跨页垂直偏移", () => {
    expect(viewSource).toContain('className="apple-page-bar flex-wrap justify-between gap-4"');
  });
});

describe("Skill 双端开关", () => {
  it("每行提供 Codex 与 Claude Code 两个独立开关，各自走同一套启停逻辑", () => {
    expect(viewSource).toContain('onRun(skill.name, skill.claude_enabled ? "disable" : "enable", "claude")');
    expect(viewSource).toContain('onRun(skill.name, skill.enabled ? "disable" : "enable")');
    expect(viewSource).toContain("api.enableSkill(name, tool)");
    expect(viewSource).toContain("api.disableSkill(name, tool)");
  });
});

describe("availableCount 刷新时机", () => {
  it("导入、删除与文件夹导入成功后立即重扫候选，角标不等窗口重新聚焦", () => {
    // 批量导入、删除、文件夹导入都会改变候选集；三处 refresh(true) 后必须跟 scanForUpdates()（同行或换行注释均可）
    const callSites = viewSource.match(/await refresh\(true\);\s*(?:\/\/[^\n]*\n\s*)?void scanForUpdates\(\);/g) ?? [];
    expect(callSites).toHaveLength(3);
  });
});
