// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackProvider } from "../../app/Feedback";
import { AppUpdateProvider } from "../updates/AppUpdateProvider";
import { SettingsAbout, SettingsGeneral, backupTitle, formatSize, formatTimestamp } from "./SettingsSections";
import ChatGPTAccount from "./ChatGPTAccount";
import { setupI18n } from "../../i18n";
import { webInvoke } from "../../api/web-mock";
import type { AuthStatus, Settings } from "../../types";

const settingsSectionsSource = readFileSync(new URL("./SettingsSections.tsx", import.meta.url), "utf8");
const settingsViewSource = readFileSync(new URL("./SettingsView.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../style.css", import.meta.url), "utf8");

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

  it("keeps the active theme option at normal weight", () => {
    const form: Settings = { theme: "system", language: "system", auto_restart: false, autostart_enabled: false, silent_start: false, minimize_to_tray: false, auto_check_update: true, auto_backup_interval_hours: 0, database_backup_keep_count: 5 };
    const html = renderToStaticMarkup(
      <FeedbackProvider><SettingsGeneral form={form} onPatch={() => undefined} /></FeedbackProvider>,
    );
    const activeButton = html.match(/<button[^>]*aria-pressed="true"[^>]*>/)?.[0];
    expect(activeButton).toContain("font-normal");
    expect(activeButton).toContain("app-selection-state");
    expect(activeButton).toContain('data-active="true"');
    expect(activeButton).not.toContain("bg-(--selection-bg)");
    expect(activeButton).not.toContain("font-semibold");
  });

  it("provides a manual app update check in the about section", () => {
    setupI18n("zh-CN");
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

  it("检测到更新后将动作和版本号合并到同一个升级药丸", () => {
    expect(settingsSectionsSource).toContain('t("about.upgradeTo")');
    expect(settingsSectionsSource).not.toContain('t("about.updateNow")');
    expect(settingsSectionsSource).toContain('t("about.changelog")');
    expect(settingsSectionsSource).toContain("releaseNotesUrl(update?.version ?? version.trim())");
    expect(settingsSectionsSource).toContain('if (!found) feedback.success(t("about.upToDate"))');
    expect(settingsSectionsSource).toMatch(/t\("about\.upgradeTo"\)\}\s+v\{update\.version\}/);
    expect(settingsSectionsSource).not.toContain('className="app-version" title={t("about.updateAvailable"');
    expect(settingsSectionsSource).not.toContain("update-available-card");
    expect(settingsSectionsSource).not.toContain("update-available-reveal");
    // 不再沿用旧逻辑：检查到新版立即自动下载安装
    expect(settingsSectionsSource).not.toContain("正在下载并安装");
    expect(settingsSectionsSource).not.toContain("await update.install()");
  });

  it("更新弹窗 logo 不跟随全局主题反色", () => {
    expect(styles).toContain(".app-dialog-hero .app-logo {\n  filter: none;\n}");
  });

  it("更新检查支持启动自动检查（可开关）与关于页手动触发并存", () => {
    const appShellPath = new URL("../../app/AppShell.tsx", import.meta.url);
    const appShellSource = readFileSync(appShellPath, "utf8");
    expect(appShellSource).toContain("<AppUpdateProvider enabled={Boolean(state?.settings.auto_check_update)}>");
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
    expect(settingsViewSource).toContain('t("codex.autoCheckDescription")');
    const form: Settings = { theme: "system", language: "system", auto_restart: false, autostart_enabled: false, silent_start: false, minimize_to_tray: false, auto_check_update: true, auto_backup_interval_hours: 0, database_backup_keep_count: 5 };
    const html = renderToStaticMarkup(
      <FeedbackProvider><SettingsGeneral form={form} onPatch={() => undefined} /></FeedbackProvider>,
    );
    expect(html).not.toContain("自动检查更新");
  });

  it("语言选择控件按当前界面语言渲染，切换语言后文案随之变化", () => {
    const form: Settings = { theme: "system", language: "system", auto_restart: false, autostart_enabled: false, silent_start: false, minimize_to_tray: false, auto_check_update: true, auto_backup_interval_hours: 0, database_backup_keep_count: 5 };
    const render = () =>
      renderToStaticMarkup(
        <FeedbackProvider><SettingsGeneral form={form} onPatch={() => undefined} /></FeedbackProvider>,
      );

    setupI18n("zh-CN");
    const zhHtml = render();
    expect(zhHtml).toContain("界面语言");
    expect(zhHtml).toContain("外观主题");
    expect(zhHtml.indexOf("界面语言")).toBeLessThan(zhHtml.indexOf("外观主题"));
    expect(zhHtml).toContain("自动检测");

    setupI18n("en-US");
    const enHtml = render();
    expect(enHtml).toContain("Language");
    expect(enHtml).toContain("Appearance");
    expect(enHtml).toContain("English");
    expect(enHtml).not.toContain("界面语言");
  });

  it("语言设置使用左右分布的下拉选择框", () => {
    const form: Settings = { theme: "system", language: "system", auto_restart: false, autostart_enabled: false, silent_start: false, minimize_to_tray: false, auto_check_update: true, auto_backup_interval_hours: 0, database_backup_keep_count: 5 };
    setupI18n("zh-CN");
    const html = renderToStaticMarkup(
      <FeedbackProvider><SettingsGeneral form={form} onPatch={() => undefined} /></FeedbackProvider>,
    );
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('class="flex items-center justify-between gap-4"');
  });

  it("外观与语言设置共享统一的右侧控制列宽度", () => {
    expect(settingsSectionsSource).toContain('<div className="w-72 shrink-0">');
    expect(settingsSectionsSource).toContain('className="apple-group apple-segmented-control inline-flex w-72 shrink-0 gap-1 p-1"');
    expect(settingsSectionsSource).toContain('className="app-selection-state inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-normal"');
    expect(settingsSectionsSource).not.toContain('<div className="w-44 shrink-0">');
    expect(settingsSectionsSource).not.toContain('className="app-selection-state inline-flex h-9 w-28 items-center justify-center gap-1.5 rounded-full text-sm font-normal"');
  });

  it("显示偏好与启动开关统一使用左右设置行", () => {
    const form: Settings = { theme: "system", language: "system", auto_restart: false, autostart_enabled: false, silent_start: false, minimize_to_tray: false, auto_check_update: true, auto_backup_interval_hours: 0, database_backup_keep_count: 5 };
    setupI18n("zh-CN");
    const html = renderToStaticMarkup(
      <FeedbackProvider><SettingsGeneral form={form} onPatch={() => undefined} /></FeedbackProvider>,
    );
    expect(html.match(/class="flex items-center justify-between gap-4"/g)).toHaveLength(5);
    expect(html.match(/role="switch"/g)).toHaveLength(3);
    expect(html.match(/settings-icon-tile/g)).toHaveLength(5);
  });

  it("通用设置按语义拆分为外观语言和启动行为分组", () => {
    const form: Settings = { theme: "system", language: "system", auto_restart: false, autostart_enabled: false, silent_start: false, minimize_to_tray: false, auto_check_update: true, auto_backup_interval_hours: 0, database_backup_keep_count: 5 };
    setupI18n("zh-CN");
    const html = renderToStaticMarkup(
      <FeedbackProvider><SettingsGeneral form={form} onPatch={() => undefined} /></FeedbackProvider>,
    );
    expect(html).toContain("外观与语言");
    expect(html).toContain("启动行为");
  });

  it("其他设置分区使用内容语义作为左上角分组标题", () => {
    expect(settingsViewSource).toContain('label={t("account.sectionTitle")}');
    expect(settingsViewSource).toContain('label={t("codex.sectionTitle")}');
    expect(settingsViewSource).toContain('label={t("backup.sectionTitle")}');
    expect(settingsViewSource).toContain('label={t("about.sectionTitle")}');
  });

  it("设置项图标统一复用深浅主题的主按钮颜色", () => {
    expect(styles).toContain(".settings-page .settings-icon-tile {\n  background: var(--primary-button-bg);\n  color: var(--primary-button-text);\n}");
  });

  it("账号行先显示账号，再以次要层级显示登录方式", () => {
    const status: AuthStatus = {
      authenticated: true,
      default_account_id: "desktop",
      external: { id: "desktop", login: "desktop@example.com", authenticated_at: 0, is_default: true },
      accounts: [{ id: "oauth", login: "oauth@example.com", authenticated_at: 0, is_default: false }],
    };
    setupI18n("zh-CN");
    const html = renderToStaticMarkup(<FeedbackProvider><ChatGPTAccount initialStatus={status} /></FeedbackProvider>);
    expect(html.indexOf("desktop@example.com")).toBeLessThan(html.indexOf("跟随 Codex登录"));
    expect(html.indexOf("oauth@example.com")).toBeLessThan(html.indexOf("OAuth 设备码登录"));
  });

  it("移除按钮跟随账号行高度", () => {
    expect(styles).toContain(".apple-action-button--compact {\n  align-self: stretch;\n  height: auto;\n");
  });

  it("浏览器调试的 get_settings 返回设置对象", async () => {
    const settings = await webInvoke<Settings>("get_settings");
    expect(settings.language).toBe("system");
    expect(settings).not.toHaveProperty("profiles");
  });
});
