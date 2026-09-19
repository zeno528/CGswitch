// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("AppShell 页面加载策略", () => {
  it("所有页面静态加载：切页零延迟，不出现懒加载骨架", () => {
    expect(source).toContain('import ProfilesView from "../features/profiles/ProfilesView";');
    expect(source).toContain('import McpView from "../features/mcp/McpView";');
    expect(source).toContain('import PluginsView from "../features/plugins/PluginsView";');
    expect(source).toContain('import SkillsView from "../features/skills/SkillsView";');
    expect(source).toContain('import AccountsView from "../features/accounts/AccountsView";');
    expect(source).toContain('import SettingsView from "../features/settings/SettingsView";');
  });

  it("禁止懒加载切页：lazy/Suspense 会造成首次切页骨架闪现", () => {
    expect(source).not.toContain("lazy(");
    expect(source).not.toContain("Suspense");
  });
});
