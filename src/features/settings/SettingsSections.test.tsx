// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackProvider } from "../../app/Feedback";
import { AppUpdateProvider } from "../updates/AppUpdateProvider";
import { SettingsAbout, SettingsAdvanced, SettingsGeneral, backupTitle, formatSize, formatShortTimestamp, formatTimestamp, isAutoBackupName, isManualBackupName } from "./SettingsSections";
import AccountsView from "../accounts/AccountsView";
import { setupI18n } from "../../i18n";
import { webInvoke } from "../../api/web-mock";
import type { AuthStatus, ProfileBalanceInfo, Settings } from "../../types";

const settingsSectionsSource = readFileSync(new URL("./SettingsSections.tsx", import.meta.url), "utf8");
const settingsViewSource = readFileSync(new URL("./SettingsView.tsx", import.meta.url), "utf8");
const accountsViewSource = readFileSync(new URL("../accounts/AccountsView.tsx", import.meta.url), "utf8");
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

  it("识别自动备份的时间戳文件名", () => {
    expect(isAutoBackupName("cg-backup-20260822-120000-000.db")).toBe(true);
    expect(isAutoBackupName("cgswitch-export-demo.db")).toBe(false);
    // 手动「立即备份」带 manual- 标记，自动备份没有
    expect(isManualBackupName("cg-backup-manual-20260923-120000-000.db")).toBe(true);
    expect(isManualBackupName("cg-backup-20260822-120000-000.db")).toBe(false);
  });

  it("formats short timestamps for auto backup row titles", () => {
    expect(formatShortTimestamp(0)).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it("备份管理为外围大卡嵌三张小卡：操作、自动备份、备份记录", () => {
    setupI18n("zh-CN");
    const form: Settings = { theme: "system", language: "system", auto_restart: false, autostart_enabled: false, silent_start: false, minimize_to_tray: false, auto_check_update: true, auto_backup_interval_hours: 0, database_backup_keep_count: 5 };
    const html = renderToStaticMarkup(
      <FeedbackProvider><SettingsAdvanced form={form} onPatch={() => undefined} paths={[]} backupsEpoch={0} onOpenPath={() => undefined} onRefresh={() => Promise.resolve()} /></FeedbackProvider>,
    );
    expect(html).toContain("数据备份");
    expect(html).toContain("备份记录");
    // 首帧无缓存时不渲染空态文案：切分页重挂载靠缓存直出，不闪"还没有备份记录"
    expect(html).not.toContain("还没有备份记录。");
    // 外围一张大卡分节，内嵌卡片只给备份频率/最多保留选项与每条备份记录，备份记录不再折叠
    expect(html.match(/role="switch"/g)).toHaveLength(1);
    expect(settingsSectionsSource).toContain("onCheckedChange={(on) => onPatch({ auto_backup_interval_hours: on ? 6 : 0 })}");
    expect(settingsSectionsSource).not.toContain('t("backup.off")');
    expect(html).toContain("备份频率");
    expect(html).toContain("按备份频率自动创建");
    // 开关同时控制备份频率与最多保留两个下拉，关掉都禁用
    expect(settingsSectionsSource.match(/disabled=\{form.auto_backup_interval_hours === 0\}/g)).toHaveLength(2);
    expect(html).toContain("disabled");
    // 操作按钮在数据备份小卡内整排等宽铺开
    expect(settingsSectionsSource.match(/apple-action-button flex-1/g)).toHaveLength(3);
    // 记录行独立成卡（apple-list-row 脱离 list-card 自带底色描边），来源用高亮药丸标记；
    // 药丸等宽居中，英文 Auto/Manual 长短不一也不把标题列推歪
    expect(settingsSectionsSource).toContain("apple-chip--accent");
    expect(settingsSectionsSource).toContain("apple-chip--success");
    expect(settingsSectionsSource).toContain('apple-chip apple-chip--roomy shrink-0');
    expect(settingsSectionsSource).toContain('className="apple-list-row"');
    expect(settingsSectionsSource).not.toContain('"apple-list-card"');
    expect(settingsSectionsSource).not.toContain('className="space-y-2"');
    expect(settingsSectionsSource).not.toContain("apple-nested-card");
    expect(styles).toContain(".apple-chip--success {");
    // 备份记录摘要行可点折叠：复用 AppDisclosure，不另写展开收缩；
    // 折叠状态用模块级变量做会话内记忆（切分页不重置，重启回默认展开）
    expect(settingsSectionsSource).toContain("<AppDisclosure");
    expect(settingsSectionsSource).toContain("setRecordsOpen");
    expect(settingsSectionsSource).toContain('className="backup-records-disclosure py-4"');
    expect(settingsSectionsSource).toContain("let recordsOpenSession = false");
    expect(settingsSectionsSource).toContain("recordsOpenSession = open");
    // 大卡内部用分割线分节；频率/保留两块选项走内嵌小卡（描边圆角 p-3）
    expect(settingsSectionsSource).toContain('className="flex flex-col divide-y divide-[var(--panel-divider)]"');
    expect(settingsSectionsSource.match(/rounded-xl border border-\[var\(--panel-border\)\] p-3/g)).toHaveLength(2);
    expect(settingsSectionsSource).not.toContain("apple-panel-section");
    // 立即备份是唯一的实心主按钮，导入/导出/文件夹保持次级药丸
    expect(html.match(/app-button--primary/g)).toHaveLength(1);
    // 操作区常显不折叠（无 backupOpen 状态）
    expect(settingsSectionsSource).not.toContain("backupOpen");
    expect(settingsSectionsSource).toContain("apple-inline-btn--quiet");
    expect(settingsSectionsSource).toContain('aria-haspopup="menu"');
    expect(settingsSectionsSource).toContain('role="menuitem"');
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
    setupI18n("zh-CN");
    const html = renderToStaticMarkup(
      <FeedbackProvider>
        <AppUpdateProvider enabled={false}>
          <SettingsAbout
            paths={[
              { label: "about.paths.appData", path: "C:\\Users\\<user>\\.cgswitch" },
              { label: "about.paths.backups", path: "C:\\Users\\<user>\\.cgswitch\\backups\\database" },
              { label: "about.paths.logs", path: "C:\\Users\\<user>\\.cgswitch\\logs" },
              { label: "about.paths.codexConfig", path: "C:\\Users\\<user>\\.codex\\config.toml" },
            ]}
            onOpenPath={() => undefined}
            openingPath={null}
          />
        </AppUpdateProvider>
      </FeedbackProvider>,
    );
    expect(html).toContain("应用数据目录");
    expect(html).toContain("日志目录");
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

  it("关于页 logo 高度与品牌信息块对齐", () => {
    expect(settingsSectionsSource).toContain('className="app-logo h-12 w-12 shrink-0"');
    expect(settingsSectionsSource).not.toContain('className="app-logo h-13 w-13 shrink-0"');
  });

  it("设置顶部标签栏底线复用全局分割线", () => {
    expect(settingsViewSource).toContain("border-b border-[var(--panel-divider)]");
    expect(settingsViewSource).not.toContain("border-b border-[var(--panel-border)]");
  });

  it("更新检查支持启动自动检查（可开关）与关于页手动触发并存", () => {
    const appShellPath = new URL("../../app/AppShell.tsx", import.meta.url);
    const appShellSource = readFileSync(appShellPath, "utf8");
    // 完整 JSX 串由 appShellLayout.test.ts 独家断言；这里只验证开关由设置项驱动。
    expect(appShellSource).toContain("enabled={Boolean(state?.settings.auto_check_update)");
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
    expect(zhHtml.indexOf("外观主题")).toBeLessThan(zhHtml.indexOf("界面语言"));
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
    expect(html).toMatch(/class="flex items-center justify-between gap-4(?: [^"]*)?"/);
  });

  it("外观与语言设置共享统一的右侧控制列宽度", () => {
    expect(settingsSectionsSource).toContain('<div className="w-72 shrink-0">');
    expect(settingsSectionsSource).toContain('className="apple-group apple-segmented-control inline-flex h-9 w-72 shrink-0 gap-0.5 p-0.5"');
    expect(settingsSectionsSource).toContain('className="app-selection-state inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-normal"');
    expect(settingsSectionsSource).not.toContain('<div className="w-44 shrink-0">');
    expect(settingsSectionsSource).not.toContain('className="app-selection-state inline-flex h-9 w-28 items-center justify-center gap-1.5 rounded-full text-sm font-normal"');
  });

  it("通用设置卡片的分割线位于选项间距中央", () => {
    expect(settingsSectionsSource).toContain('className="flex flex-col divide-y divide-[var(--panel-divider)]"');
    expect(settingsSectionsSource).toContain('className="flex items-center justify-between gap-4 py-4"');
    expect(settingsSectionsSource).not.toContain('className="flex items-center justify-between gap-4 pb-2"');
    expect(settingsSectionsSource).not.toContain('className="flex items-center justify-between gap-4 pt-2"');
    expect(settingsSectionsSource).not.toContain('className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0"');
  });

  it("设置卡片使用统一的行内上下留白", () => {
    const generalSource = settingsSectionsSource.slice(
      settingsSectionsSource.indexOf("export function SettingsGeneral"),
      settingsSectionsSource.indexOf("interface SettingsAdvancedProps"),
    );
    expect(generalSource).toContain('<div className="apple-group px-[var(--gap-card-inline)]">');
    expect(generalSource).not.toContain('<div className="apple-group p-[var(--gap-card)]">');
  });

  it("应用与更新卡片与通用卡片使用相同的上下留白", () => {
    expect(settingsViewSource).toContain('<div className="apple-group px-[var(--gap-card-inline)]">');
    expect(settingsViewSource).toContain('className="flex flex-col divide-y divide-[var(--panel-divider)]"');
    expect(settingsViewSource).toContain('className="flex items-center justify-between gap-4 py-4"');
    expect(settingsViewSource).not.toContain('className="flex flex-col gap-5"');
  });

  it("显示偏好与启动开关统一使用左右设置行", () => {
    const form: Settings = { theme: "system", language: "system", auto_restart: false, autostart_enabled: false, silent_start: false, minimize_to_tray: false, auto_check_update: true, auto_backup_interval_hours: 0, database_backup_keep_count: 5 };
    setupI18n("zh-CN");
    const html = renderToStaticMarkup(
      <FeedbackProvider><SettingsGeneral form={form} onPatch={() => undefined} /></FeedbackProvider>,
    );
    expect(html.match(/flex items-center justify-between gap-4/g)).toHaveLength(5);
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

  it("账号管理已从设置分区移出", () => {
    expect(settingsViewSource).not.toContain('tab("account"');
    expect(settingsViewSource).not.toContain('account.sectionTitle');
    expect(settingsViewSource).toContain('label={t("codex.sectionTitle")}');
    expect(settingsViewSource).toContain('label={t("backup.sectionTitle")}');
    expect(settingsViewSource).toContain('label={t("about.sectionTitle")}');
  });

  it("设置项图标统一复用深浅主题的主按钮颜色", () => {
    expect(styles).toContain(".settings-page .settings-icon-tile,\n.accounts-page .settings-icon-tile {\n  background: var(--primary-button-bg);\n  color: var(--primary-button-text);\n}");
  });

  it("账号页以两列卡片展示账号行", () => {
    const status: AuthStatus = {
      authenticated: true,
      default_account_id: "desktop",
      external: [{ id: "desktop", login: "desktop@example.com", authenticated_at: 0, is_default: true, plan_type: "plus", subscription_active_until: 1_789_694_940_000 }],
      accounts: [{ id: "oauth", login: "oauth@example.com", authenticated_at: 0, is_default: false, plan_type: "pro", subscription_active_until: 1_789_694_940_000 }],
    };
    const balance: ProfileBalanceInfo = {
      currency: "", total_balance: "", granted_balance: "", topped_up_balance: "",
      usage_percent: 18, usage_reset: "3h12m", usage_reset_at: Date.now() + 3 * 3_600_000, weekly_usage_percent: null, weekly_reset: null,
      reset_credits_available: 2,
      reset_credits: [
        { id: "credit-1", reset_type: "codex_rate_limits", expires_at: Date.now() + 16 * 86_400_000 },
        { id: "credit-2", expires_at: Date.now() + 17 * 86_400_000 },
      ],
    };
    setupI18n("zh-CN");
    const html = renderToStaticMarkup(<FeedbackProvider><AccountsView initialStatus={status} balanceCache={{ "auth:desktop:desktop": balance }} /></FeedbackProvider>);
    expect(html.indexOf("desktop@example.com")).toBeLessThan(html.indexOf("Codex 桌面端"));
    expect(html.indexOf("oauth@example.com")).toBeLessThan(html.indexOf("OAuth 登录"));
    // 套餐徽标：官方原词首字母大写，pro 走强调色 chip
    expect(html).toContain(">Plus</span>");
    expect(html).toContain(">Pro</span>");
    expect(html.match(/套餐续期日（[^）]+）：/g)).toHaveLength(2);
    expect(html).toContain("天后");
    expect(accountsViewSource).toContain('timeZoneName: "short"');
    expect(html.indexOf("Codex 桌面端")).toBeLessThan(html.indexOf(">Plus</span>"));
    expect(html).toContain("2 次");
    expect(html).toContain("完全重置");
    expect(html).toContain("到期：");
    expect(html).toContain("3h12m 后");
    expect(accountsViewSource).toContain('month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit"');
    expect(html).not.toContain("恢复 5 小时和每周使用限额");
    const zeroCreditHtml = renderToStaticMarkup(<FeedbackProvider><AccountsView initialStatus={status} balanceCache={{ "auth:desktop:desktop": { ...balance, reset_credits_available: 0, reset_credits: [] } }} /></FeedbackProvider>);
    expect(zeroCreditHtml).not.toContain("可用 0 张重置卡");
    const freeHtml = renderToStaticMarkup(<FeedbackProvider><AccountsView initialStatus={{ ...status, external: [{ ...status.external[0]!, plan_type: "free" }], accounts: [] }} /></FeedbackProvider>);
    expect(freeHtml).toContain(">Free</span>");
    expect(freeHtml).not.toContain("套餐续期日：");
    expect(accountsViewSource).toContain('grid grid-cols-1 gap-[var(--gap-card)] md:grid-cols-2');
    expect(accountsViewSource).toContain('source="desktop"');
    expect(accountsViewSource).toContain('source="oauth"');
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
