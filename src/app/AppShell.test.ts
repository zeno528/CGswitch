// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./AppShell.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");

describe("AppShell 页面加载策略", () => {
  it("默认首页静态加载", () => {
    expect(source).toContain('import ProfilesView from "../features/profiles/ProfilesView";');
  });

  it("非默认管理页 lazy 按访问加载", () => {
    expect(source).toContain('const McpView = lazy(() => import("../features/mcp/McpView"));');
    expect(source).toContain('const PluginsView = lazy(() => import("../features/plugins/PluginsView"));');
    expect(source).toContain('const SkillsView = lazy(() => import("../features/skills/SkillsView"));');
    expect(source).toContain('const SettingsView = lazy(() => import("../features/settings/SettingsView"));');
    expect(source).toContain('const AccountsView = lazy(() => import("../features/accounts/AccountsView"));');
  });

  it("管理页不得回退为静态 import", () => {
    expect(source).not.toContain('import McpView from');
    expect(source).not.toContain('import PluginsView from');
    expect(source).not.toContain('import SkillsView from');
    expect(source).not.toContain('import AccountsView from');
    expect(source).not.toContain('import SettingsView from');
  });
});
