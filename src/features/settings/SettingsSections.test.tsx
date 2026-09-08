// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackProvider } from "../../app/Feedback";
import { AppUpdateProvider } from "../updates/AppUpdateProvider";
import { SettingsAbout, SettingsGeneral, backupTitle, formatSize, formatTimestamp } from "./SettingsSections";
import type { Settings } from "../../types";

const settingsSectionsSource = readFileSync(new URL("./SettingsSections.tsx", import.meta.url), "utf8");

describe("SettingsSections", () => {
  it("formats backup titles", () => {
    expect(backupTitle("cg-backup-20260822-120000-000.db")).toBe("20260822-120000-000");
    expect(backupTitle("cgswitch-export-demo.db")).toBe("demo");
  });

  it("formats backup sizes", () => {
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(1024 * 1024)).toBe("1.00 MB");
  });

  it("formats backup timestamps", () => {
    expect(formatTimestamp(0)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("provides a manual app update check in the about section", () => {
    const html = renderToStaticMarkup(
      <FeedbackProvider><AppUpdateProvider enabled={false}><SettingsAbout paths={[]} onOpenPath={() => undefined} openingPath={null} /></AppUpdateProvider></FeedbackProvider>,
    );
    expect(html).toContain("检查更新");
    expect(html).not.toContain("检查 GitHub 正式发布版本");
  });

  it("does not show the backup directory in the about paths", () => {
    const html = renderToStaticMarkup(
      <FeedbackProvider>
        <AppUpdateProvider enabled={false}>
          <SettingsAbout
            paths={[
              { label: "应用数据目录", path: "C:\\Users\\<user>\\.cgswitch" },
              { label: "备份目录", path: "C:\\Users\\<user>\\.cgswitch\\backups" },
              { label: "Codex 配置", path: "C:\\Users\\<user>\\.codex\\config.toml" },
            ]}
            onOpenPath={() => undefined}
            openingPath={null}
          />
        </AppUpdateProvider>
      </FeedbackProvider>,
    );
    expect(html).toContain("应用数据目录");
    expect(html).not.toContain("备份目录");
  });

  it("手动检查发现新版只展示版本号，升级由用户点击触发", () => {
    expect(settingsSectionsSource).toContain("立即升级");
    expect(settingsSectionsSource).toContain("更新日志");
    expect(settingsSectionsSource).toContain("if (!found) feedback.success(\"已是最新版本\")");
    // 不再沿用旧逻辑：检查到新版立即自动下载安装
    expect(settingsSectionsSource).not.toContain("正在下载并安装");
    expect(settingsSectionsSource).not.toContain("await update.install()");
  });

  it("更新检查支持启动自动检查（可开关）与关于页手动触发并存", () => {
    const appShellPath = new URL("../../app/AppShell.tsx", import.meta.url);
    const appShellSource = readFileSync(appShellPath, "utf8");
    expect(appShellSource).toContain("<AppUpdateProvider enabled={Boolean(state?.settings.auto_check_update)}>");
    expect(appShellSource).toContain("<UpdateNotice />");
    expect(settingsSectionsSource).not.toContain("useEffect(() => { void checkUpdate(); }, []);");
  });

  it("启动检查用 ref 防重入，避免 StrictMode 双跑导致重复通知", () => {
    const providerSource = readFileSync(new URL("../updates/AppUpdateProvider.tsx", import.meta.url), "utf8");
    expect(providerSource).toContain("if (!enabled || autoCheckedRef.current) return;");
    expect(providerSource).toContain("if (checkingRef.current) return update;");
  });

  it("自动检查更新开关位于应用分区而非通用区", () => {
    const settingsViewSource = readFileSync(new URL("./SettingsView.tsx", import.meta.url), "utf8");
    expect(settingsViewSource).toContain('checked={form.auto_check_update}');
    expect(settingsViewSource).toContain("启动时检查新版本，发现后在侧边栏提示更新");
    const form: Settings = { theme: "system", auto_restart: false, autostart_enabled: false, silent_start: false, minimize_to_tray: false, auto_check_update: true, auto_backup_interval_hours: 0, database_backup_keep_count: 5 };
    const html = renderToStaticMarkup(
      <FeedbackProvider><SettingsGeneral form={form} onPatch={() => undefined} /></FeedbackProvider>,
    );
    expect(html).not.toContain("自动检查更新");
  });
});
