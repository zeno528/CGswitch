import { Clock, Database, Download, ExternalLink, FolderOpen, History, Languages, LoaderCircle, Moon, MoonStar, Monitor, MoreHorizontal, Palette, PanelBottomClose, Pencil, Power, RefreshCw, RotateCcw, Save, Sun, Trash2, Upload } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { createPortal } from "react-dom";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api, isTauri } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { getCachedDatabaseBackups, loadDatabaseBackups } from "../../app/managementDataCache";
import { AppDialog } from "../../components/AppDialog";
import { AppDisclosure } from "../../components/AppDisclosure";
import { GithubMark } from "../../components/GithubMark";
import { AppSelect } from "../../components/AppSelect";
import { AppSwitch } from "../../components/AppSwitch";
import { useFixedMenuPosition } from "../../components/useFixedMenuPosition";
import { updateFailureMessage } from "../updates/updateText";
import { useAppUpdate, releaseNotesUrl } from "../updates/AppUpdateProvider";
import { UpdateNotesDialog } from "../updates/UpdateNotesDialog";
import type { DatabaseBackupInfo, PathInfo, Settings } from "../../types";
import version from "../../../VERSION?raw";

// as const 必需：labelKey 若推断为 string，typed t() 会拒绝（键名无法在编译期校验）。
const themeOptions = [{ labelKey: "theme.system", value: "system" }, { labelKey: "theme.light", value: "light" }, { labelKey: "theme.dark", value: "dark" }] as const;
const languageOptions = [{ labelKey: "language.system", value: "system" }, { labelKey: "language.zh", value: "zh-CN" }, { labelKey: "language.en", value: "en-US" }] as const;
// Rust 下发的 PathInfo.label（i18n key）数据值，用于比对而非展示
const BACKUP_DIR_LABEL = "about.paths.backups"; // i18n-exempt: 数据标签比较值，不是界面文案

// PathInfo.label 约定为 about.paths.* i18n key（Rust path_info 下发）。强类型 t 只收
// 已知 key，动态值经此处受控断言；约定外的取值原样回退，不把脏数据渲染成字面 key
const pathLabel = (t: (key: "about.paths.appData") => string, label: string): string =>
  label.startsWith("about.paths.") ? t(label as "about.paths.appData") : label;

const pad2 = (value: number) => String(value).padStart(2, "0");
export const backupTitle = (name: string) => name.replace(/^(?:cg-backup-|cgswitch-export-)/, "").replace(/\.db$/, "");
// 自动备份文件名剥前缀后是纯时间戳（20260822-120000-000），手动「立即备份」带 manual- 标记，
// 重命名过的是自由文本；行标题的"自动/手动"前缀据此区分
export const isAutoBackupName = (name: string) => /^\d{8}-\d{6}-\d{3}$/.test(backupTitle(name));
export const isManualBackupName = (name: string) => /^manual-\d{8}-\d{6}-\d{3}$/.test(backupTitle(name));
export const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
// 备份记录折叠状态的会话内记忆：切分页重挂载不丢，重启回到默认折叠（不持久化）。
// 默认折叠：记录列表随自动备份只增不减，展开态会把设置页越顶越长
let recordsOpenSession = false;
export const formatTimestamp = (seconds: number) => { const date = new Date(seconds * 1000); return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`; };
// 自动备份行标题里的短时间（MM-DD HH:mm）：完整时间在行的 meta 里，标题只做扫读锚点
export const formatShortTimestamp = (seconds: number) => { const date = new Date(seconds * 1000); return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`; };

// 设置页各分区统一的左上角标题包装：标题 id 与 aria-labelledby 成对生成
export function SettingsPanelSection({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby={`settings-content-${id}`}>
      <h2 id={`settings-content-${id}`} className="title-sm px-1">
        {label}
      </h2>
      {children}
    </section>
  );
}

interface SettingsGeneralProps { form: Settings; onPatch: (patch: Partial<Settings>) => void; }

export function SettingsGeneral({ form, onPatch }: SettingsGeneralProps) {
  const { t } = useTranslation("settings");
  return (
    <div className="flex flex-col gap-[var(--gap-section)]">
      <SettingsPanelSection id="appearance-language" label={t("general.appearanceGroupTitle")}>
        <div className="apple-group px-[var(--gap-card-inline)]">
          <div className="flex flex-col divide-y divide-[var(--panel-divider)]">
            <div className="flex items-center justify-between gap-4 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl">
                  <Languages className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="setting-title">{t("language.title")}</div>
                  <div className="setting-description mt-0.5">{t("language.description")}</div>
                </div>
              </div>
              <div className="w-72 shrink-0">
                <AppSelect
                  value={form.language}
                  options={languageOptions.map((option) => ({ label: t(option.labelKey), value: option.value }))}
                  onChange={(value) => onPatch({ language: value })}
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-4 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl">
                  <Palette className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="setting-title">{t("appearance.title")}</div>
                  <div className="setting-description mt-0.5">{t("appearance.description")}</div>
                </div>
              </div>
              <div className="apple-group apple-segmented-control inline-flex h-9 w-72 shrink-0 gap-0.5 p-0.5">
                {themeOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className="app-selection-state inline-flex h-full flex-1 items-center justify-center gap-1.5 rounded-full text-sm font-normal"
                    data-active={form.theme === option.value ? "true" : undefined}
                    aria-pressed={form.theme === option.value}
                    onClick={() => onPatch({ theme: option.value })}
                  >
                    {option.value === "system" ? <Monitor className="h-4 w-4" strokeWidth={2} /> : option.value === "light" ? <Sun className="h-4 w-4" strokeWidth={2} /> : <Moon className="h-4 w-4" strokeWidth={2} />}
                    {t(option.labelKey)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </SettingsPanelSection>
      <SettingsPanelSection id="startup" label={t("general.startupGroupTitle")}>
        <div className="apple-group px-[var(--gap-card-inline)]">
          <div className="flex flex-col divide-y divide-[var(--panel-divider)]">
            {[
              ["autostart_enabled", t("startup.autostartTitle"), t("startup.autostartDescription"), Power],
              ["silent_start", t("startup.silentTitle"), t("startup.silentDescription"), MoonStar],
              ["minimize_to_tray", t("startup.minimizeTitle"), t("startup.minimizeDescription"), PanelBottomClose],
            ].map(([key, label, description, Icon]) => (
              <div key={String(key)} className="flex items-center justify-between gap-4 py-4">
                <div className="flex items-start gap-3">
                  <span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl">
                    <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
                  </span>
                  <div>
                    <div className="setting-title">{String(label)}</div>
                    <div className="setting-description mt-0.5">{String(description)}</div>
                  </div>
                </div>
                <AppSwitch
                  checked={Boolean(form[key as keyof Settings])}
                  onCheckedChange={(value) => onPatch({ [String(key)]: value })}
                />
              </div>
            ))}
          </div>
        </div>
      </SettingsPanelSection>
    </div>
  );
}

interface SettingsAdvancedProps { form: Settings; onPatch: (patch: Partial<Settings>) => void; paths: PathInfo[]; backupsEpoch: number; onOpenPath: (item: PathInfo) => void; onRefresh: () => Promise<void>; }

export function SettingsAdvanced({ form, onPatch, paths, backupsEpoch, onOpenPath, onRefresh }: SettingsAdvancedProps) {
  const feedback = useFeedback();
  const { t } = useTranslation("settings");
  // 开关负责自动备份的启停（关 = interval 0），下拉只管间隔，不再提供"关闭"档
  const autoBackupOptions = [{ label: t("backup.interval6h"), value: 6 }, { label: t("backup.interval12h"), value: 12 }, { label: t("backup.interval24h"), value: 24 }, { label: t("backup.interval48h"), value: 48 }, { label: t("backup.interval7d"), value: 168 }];
  const keepOptions = [3, 5, 10, 15, 20, 30].map((value) => ({ label: t("backup.keepCount", { count: value }), value }));
  // null = 尚未加载过：首帧无缓存时不渲染"还没有备份记录"空态，防切分页闪现
  const [backups, setBackups] = useState<DatabaseBackupInfo[] | null>(getCachedDatabaseBackups);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DatabaseBackupInfo | null>(null);
  const [renameText, setRenameText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(recordsOpenSession);

  // 进页先缓存直出再静默刷新（CLAUDE.md 管理页数据约定）；本地增删改/epoch 变更走 force
  const loadBackups = async (force = false) => { try { setBackups(await loadDatabaseBackups(force)); } catch { setBackups(null); } };
  useEffect(() => { void loadBackups(true); }, [backupsEpoch]);

  const exportBackupToFile = async () => {
    if (exporting) return;
    setExporting(true);
    try { let directory: string | null = null; if (isTauri) { const result = await openDialog({ title: t("backup.pickExportDir"), directory: true, multiple: false }); directory = typeof result === "string" ? result : null; if (!directory) return; } await api.exportDatabaseTo(directory ?? "mock-export"); feedback.success(t("backup.toastExported")); }
    catch (error) { feedback.error(String(error)); }
    finally { setExporting(false); }
  };
  const importBackupFromFile = async () => {
    if (importing) return;
    try { let picked: string | null = null; if (isTauri) { const result = await openDialog({ title: t("backup.pickImportFile"), multiple: false, filters: [{ name: t("backup.sqliteFilter"), extensions: ["db"] }] }); picked = typeof result === "string" ? result : null; if (!picked) return; } setImporting(true); await api.importDatabase(picked ?? "mock-backup.db"); feedback.success(t("backup.toastImported")); await onRefresh(); await loadBackups(true); }
    catch (error) { feedback.error(String(error)); }
    finally { setImporting(false); }
  };
  const createImmediateBackup = async () => { if (exporting) return; setExporting(true); try { await api.exportDatabase(); feedback.success(t("backup.toastCreated")); await loadBackups(true); } catch (error) { feedback.error(String(error)); } finally { setExporting(false); } };
  const openRename = (backup: DatabaseBackupInfo) => { setRenameTarget(backup); setRenameText(backupTitle(backup.name)); };
  const submitRename = async () => { const target = renameTarget; const text = renameText.trim(); if (!target || renaming || !text || text === backupTitle(target.name)) { setRenameTarget(null); return; } setRenaming(true); try { await api.renameDatabaseBackup(target.name, text); feedback.success(t("backup.toastRenamed")); await loadBackups(true); setRenameTarget(null); } catch (error) { feedback.error(String(error)); } finally { setRenaming(false); } };
  const restoreBackup = async (backup: DatabaseBackupInfo) => { if (!await feedback.confirm({ title: t("backup.restoreConfirmTitle"), description: t("backup.restoreConfirm", { name: backup.name }), confirmText: t("backup.restore"), destructive: true })) return; try { await api.restoreDatabase(backup.name); feedback.success(t("backup.toastRestored")); await onRefresh(); await loadBackups(true); } catch (error) { feedback.error(String(error)); } };
  const deleteBackup = async (backup: DatabaseBackupInfo) => { if (!await feedback.confirm({ title: t("backup.deleteConfirmTitle"), description: <Trans ns="settings" i18nKey="backup.deleteConfirm" values={{ name: backup.name }} components={{ strong: <strong /> }} />, confirmText: t("backup.delete"), destructive: true })) return; try { await api.deleteDatabaseBackup(backup.name); feedback.success(t("backup.toastDeleted")); await loadBackups(true); } catch (error) { feedback.error(String(error)); } };

  // ⋯ 菜单：apple-group 是 overflow:hidden，行内 absolute 弹层会被裁掉，
  // 走 portal + fixed 定位，向下/向上自适应翻转复用 AppSelect 的共享逻辑；
  // 外点 / 滚动即收起
  const [menuTarget, setMenuTarget] = useState<{ backup: DatabaseBackupInfo; trigger: HTMLElement } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuStyle = useFixedMenuPosition(menuTarget !== null, menuTarget?.trigger ?? null, menuRef, "end");
  const openMenu = (backup: DatabaseBackupInfo, trigger: HTMLElement) => {
    setMenuTarget({ backup, trigger });
  };
  useEffect(() => {
    if (!menuTarget) return;
    const close = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-row-menu], [data-row-menu-trigger]")) return;
      setMenuTarget(null);
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close, true);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("scroll", close, true); };
  }, [menuTarget]);
  const rowMenu = menuTarget ? createPortal(
    <div ref={menuRef} className="app-select-menu" data-open="true" data-row-menu role="menu" aria-label={t("backup.moreTooltip")} style={{ ...menuStyle, minWidth: "10rem" }} onKeyDown={(event) => { if (event.key === "Escape") setMenuTarget(null); }}>
      <button type="button" role="menuitem" className="app-select-option app-selection-state" onClick={() => { const target = menuTarget.backup; setMenuTarget(null); openRename(target); }}>
        <span className="flex items-center gap-2"><Pencil className="h-4 w-4" strokeWidth={2} aria-hidden="true" />{t("backup.renameAction")}</span>
      </button>
      <button type="button" role="menuitem" className="app-select-option app-selection-state app-select-option--danger" onClick={() => { const target = menuTarget.backup; setMenuTarget(null); void deleteBackup(target); }}>
        <span className="flex items-center gap-2"><Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />{t("backup.deleteAction")}</span>
      </button>
    </div>,
    document.body,
  ) : null;
  const recordsSummary = backups !== null && backups.length > 0 ? t("backup.recordSummary", { count: backups.length, size: formatSize(backups.reduce((total, backup) => total + backup.size_bytes, 0)) }) : "";

  return (
    <div className="apple-group px-[var(--gap-card-inline)]">
      <div className="flex flex-col divide-y divide-[var(--panel-divider)]">
        {/* 数据备份：标题 + 整排操作按钮 */}
        <div className="flex flex-col gap-4 py-4">
          <div className="flex items-start gap-3">
            <span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl">
              <Database className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="setting-title">{t("backup.title")}</div>
              <div className="setting-description mt-0.5">{t("backup.description")}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="apple-action-button app-button--primary flex-1" disabled={exporting} onClick={() => void createImmediateBackup()}>
              <Save className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {t("backup.createNow")}
            </button>
            <button type="button" className="apple-action-button flex-1" disabled={importing} onClick={() => void importBackupFromFile()}>
              <Download className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {t("backup.import")}
            </button>
            <button type="button" className="apple-action-button flex-1" disabled={exporting} onClick={() => void exportBackupToFile()}>
              <Upload className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {t("backup.export")}
            </button>
            <button type="button" className="apple-action-button flex-1" onClick={() => { const item = paths.find((path) => path.label === BACKUP_DIR_LABEL); if (item) onOpenPath(item); else feedback.warning(t("backup.toastFolderMissing")); }}>
              <FolderOpen className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {t("backup.folder")}
            </button>
          </div>
        </div>
        {/* 自动备份：开关在右侧控制启停，关掉时频率/保留两个下拉都不可用 */}
        <div className="flex flex-col gap-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="setting-title">{t("backup.autoLabel")}</div>
              <div className="setting-description mt-0.5">{t("backup.autoDescription")}</div>
            </div>
            <AppSwitch checked={form.auto_backup_interval_hours > 0} onCheckedChange={(on) => onPatch({ auto_backup_interval_hours: on ? 6 : 0 })} label={t("backup.autoLabel")} />
          </div>
          <div className="flex flex-wrap gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl border border-[var(--panel-border)] p-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" strokeWidth={2} aria-hidden="true" />
                <span className="field-label muted">{t("backup.frequencyLabel")}</span>
              </div>
              {/* 关闭时展示即将启用的默认间隔（与开关打开写入的 6 一致），避免显示裸 0 */}
              <AppSelect value={form.auto_backup_interval_hours || 6} options={autoBackupOptions} disabled={form.auto_backup_interval_hours === 0} onChange={(value) => onPatch({ auto_backup_interval_hours: value })} />
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-xl border border-[var(--panel-border)] p-3">
              <div className="flex items-center gap-2">
                <Database className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" strokeWidth={2} aria-hidden="true" />
                <span className="field-label muted">{t("backup.keepLabel")}</span>
              </div>
              <AppSelect value={form.database_backup_keep_count} options={keepOptions} disabled={form.auto_backup_interval_hours === 0} onChange={(value) => onPatch({ database_backup_keep_count: value })} />
            </div>
          </div>
        </div>
        {/* 备份记录：摘要行可点折叠（复用 AppDisclosure）；行独立成卡，来源用高亮药丸标记 */}
        <AppDisclosure
          className="backup-records-disclosure py-4"
          open={recordsOpen}
          onOpenChange={(open) => { recordsOpenSession = open; setRecordsOpen(open); }}
          summary={(
            <>
              <span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl">
                <History className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="setting-title block">{t("backup.recordsTitle")}</span>
                <span className="setting-description mt-0.5 block">{recordsSummary}</span>
              </span>
            </>
          )}
        >
          {backups !== null && backups.length > 0 ? (
            <div className="flex flex-col gap-2">
              {backups.map((backup) => {
                const menuOpen = menuTarget?.backup.name === backup.name;
                const auto = isAutoBackupName(backup.name);
                return (
                  <div key={backup.name} className="apple-list-row">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className={`apple-chip apple-chip--roomy shrink-0 ${auto ? "apple-chip--accent" : "apple-chip--success"}`}>{auto ? t("backup.badgeAuto") : t("backup.badgeManual")}</span>
                      <div className="min-w-0">
                        <div className="field-label truncate">{auto || isManualBackupName(backup.name) ? formatShortTimestamp(backup.created_at) : backupTitle(backup.name)}</div>
                        <div className="muted meta-xs mt-0.5 truncate">{formatTimestamp(backup.created_at)} · {formatSize(backup.size_bytes)}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button type="button" className="apple-inline-btn apple-inline-btn--quiet" onClick={() => void restoreBackup(backup)}><RotateCcw className="h-4 w-4" strokeWidth={2} aria-hidden="true" />{t("backup.restore")}</button>
                      <button type="button" className="apple-icon-button text-[var(--text-secondary)] hover:text-accent" data-row-menu-trigger aria-haspopup="menu" aria-expanded={menuOpen} aria-label={t("backup.moreTooltip")} onClick={(event) => (menuOpen ? setMenuTarget(null) : openMenu(backup, event.currentTarget))} onKeyDown={(event) => { if (event.key === "Escape") setMenuTarget(null); }}>
                        <MoreHorizontal className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : backups !== null ? (
            <div className="setting-description flex items-center gap-2">
              <Database className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
              {t("backup.empty")}
            </div>
          ) : null}
        </AppDisclosure>
      </div>
      {rowMenu}
      <AppDialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null); }} title={t("backup.renameDialogTitle")} footer={<><button type="button" className="apple-action-button" onClick={() => setRenameTarget(null)}>{t("backup.cancel")}</button><button type="button" className="apple-action-button app-button--primary" disabled={renaming || !renameText.trim()} onClick={() => void submitRename()}>{t("backup.save")}</button></>}><input className="app-input" maxLength={80} placeholder={t("backup.renamePlaceholder")} value={renameText} onChange={(event) => setRenameText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void submitRename(); }} /></AppDialog>
    </div>
  );
}

interface SettingsAboutProps { paths: PathInfo[]; onOpenPath: (item: PathInfo) => void; openingPath: string | null; }

export function SettingsAbout({ paths, onOpenPath, openingPath }: SettingsAboutProps) {
  const feedback = useFeedback();
  const { t } = useTranslation("settings");
  // 更新失败提示的文案归 updates 命名空间，故另取一个对应的 t
  const { t: tUpdate } = useTranslation("updates");
  const { update, checking, installing, check } = useAppUpdate();
  // 与状态栏悬浮卡片一致：升级走确认式弹窗，先看更新日志再安装
  const [confirming, setConfirming] = useState(false);
  const openRepository = () => void api.openUrl("https://github.com/zeno528/CGSwitch").catch((error) => feedback.error(String(error)));
  // 检查只负责发现并展示版本号，升级必须由用户点击「立即重启更新」触发
  const checkUpdate = async () => {
    try {
      const found = await check();
      if (!found) feedback.success(t("about.upToDate"));
    } catch (error) {
      feedback.error(updateFailureMessage(error, tUpdate));
    }
  };

  return (
    <div className="apple-group px-[var(--gap-card-inline)] py-[var(--gap-card)]">
      <div className="settings-about__hero brand-gradient-surface">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="CGswitch" className="app-logo h-12 w-12 shrink-0" />
            <div>
              <div className="apple-wordmark">CGswitch</div>
              <div className="app-version mt-1.5">{t("about.version", { version: version.trim() })}</div>
            </div>
          </div>
          <div className="settings-about__actions flex flex-wrap gap-2">
          <button type="button" className="apple-action-button" title={t("about.openRepo")} onClick={openRepository}>
            <GithubMark className="h-4 w-4" />
            GitHub
            <ExternalLink className="h-3.5 w-3.5 text-[var(--text-secondary)]" strokeWidth={2} aria-hidden="true" />
          </button>
          <button type="button" className="apple-action-button" title={t("about.viewReleases")} onClick={() => void api.openUrl(releaseNotesUrl(update?.version ?? version.trim())).catch((error) => feedback.error(String(error)))}>
            <History className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
            {t("about.changelog")}
          </button>
          {update ? (
            <button type="button" className="apple-action-button app-button--primary" disabled={installing} onClick={() => setConfirming(true)}>
              {installing ? <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" /> : <Download className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
              {installing ? t("about.installing") : t("about.upgradeTo")} v{update.version}
            </button>
          ) : (
            <button type="button" className="apple-action-button" disabled={checking} onClick={() => void checkUpdate()}>
              <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} strokeWidth={2} />
              {t("about.checkUpdate")}
            </button>
          )}
          </div>
        </div>
        <hr className="my-4 border-0 border-t border-t-transparent" />
      </div>
      <h2 className="setting-title">{t("about.dataAndPaths")}</h2>
      <div className="mt-2 divide-y divide-[var(--panel-divider)] overflow-hidden rounded-[var(--radius-control)] border border-[var(--panel-ring)]">
        {paths.filter((item) => item.label !== BACKUP_DIR_LABEL).map((item) => (
          <button key={item.label} type="button" className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/8" disabled={Boolean(openingPath)} title={t("about.openPath", { label: pathLabel(t, item.label) })} onClick={() => onOpenPath(item)}>
            <span className="shrink-0 text-sm font-medium">{pathLabel(t, item.label)}</span>
            <span className="mono muted meta-xs min-w-0 flex-1 truncate" title={item.path}>{item.path.replace(/^\/(Users|home)\/[^/]+/, "~")}</span>
            {openingPath === item.path ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-accent" strokeWidth={2} /> : <FolderOpen className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" strokeWidth={2} />}
          </button>
        ))}
      </div>
      <UpdateNotesDialog open={confirming} onOpenChange={setConfirming} />
    </div>
  );
}
