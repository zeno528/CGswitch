import { Database, DatabaseBackup, Download, ExternalLink, FolderOpen, History, Languages, LoaderCircle, Moon, MoonStar, Monitor, Palette, PanelBottomClose, Pencil, Power, RefreshCw, Save, Sun, Upload } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api, isTauri } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { AppDialog } from "../../components/AppDialog";
import { AppDisclosure } from "../../components/AppDisclosure";
import { GithubMark } from "../../components/GithubMark";
import { AppSelect } from "../../components/AppSelect";
import { AppSwitch } from "../../components/AppSwitch";
import { TrashIcon } from "../../components/TrashIcon";
import { updateFailureMessage } from "../updates/updateText";
import { useAppUpdate, releaseNotesUrl } from "../updates/AppUpdateProvider";
import type { DatabaseBackupInfo, PathInfo, Settings } from "../../types";
import version from "../../../VERSION?raw";

// as const 必需：labelKey 若推断为 string，typed t() 会拒绝（键名无法在编译期校验）。
const themeOptions = [{ labelKey: "theme.system", value: "system" }, { labelKey: "theme.light", value: "light" }, { labelKey: "theme.dark", value: "dark" }] as const;
const languageOptions = [{ labelKey: "language.system", value: "system" }, { labelKey: "language.zh", value: "zh-CN" }, { labelKey: "language.en", value: "en-US" }] as const;
// Rust 下发的 PathInfo.label 数据值，用于比对而非展示
const BACKUP_DIR_LABEL = "备份目录"; // i18n-exempt: 数据标签比较值，不是界面文案

export const backupTitle = (name: string) => name.replace(/^(?:cg-backup-|cgswitch-export-)/, "").replace(/\.db$/, "");
export const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
export const formatTimestamp = (seconds: number) => { const date = new Date(seconds * 1000); const pad = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`; };

interface SettingsGeneralProps { form: Settings; onPatch: (patch: Partial<Settings>) => void; }

export function SettingsGeneral({ form, onPatch }: SettingsGeneralProps) {
  const { t } = useTranslation("settings");
  return (
    <div className="apple-group mt-[var(--gap-section)] p-[var(--gap-card)]">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl text-accent">
              <Palette className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="setting-title">{t("appearance.title")}</div>
              <div className="setting-description mt-0.5">{t("appearance.description")}</div>
            </div>
          </div>
          <div className="apple-group apple-segmented-control inline-flex shrink-0 gap-1 p-1">
            {themeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className="app-selection-state inline-flex h-9 w-28 items-center justify-center gap-1.5 rounded-full text-sm font-normal"
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
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl text-accent">
              <Languages className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <div className="setting-title">{t("language.title")}</div>
              <div className="setting-description mt-0.5">{t("language.description")}</div>
            </div>
          </div>
          <div className="w-44 shrink-0">
            <AppSelect
              value={form.language}
              options={languageOptions.map((option) => ({ label: t(option.labelKey), value: option.value }))}
              onChange={(value) => onPatch({ language: value })}
            />
          </div>
        </div>
      </div>
      <hr className="my-4 border-0 border-t border-[var(--panel-divider)]" />
      <div className="flex flex-col gap-5">
        {[
          ["autostart_enabled", t("startup.autostartTitle"), t("startup.autostartDescription"), Power, "text-accent"],
          ["silent_start", t("startup.silentTitle"), t("startup.silentDescription"), MoonStar, "text-[var(--lavender)]"],
          ["minimize_to_tray", t("startup.minimizeTitle"), t("startup.minimizeDescription"), PanelBottomClose, "text-[var(--warning)]"],
        ].map(([key, label, description, Icon, color]) => (
          <div key={String(key)} className="flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className={`settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl ${String(color)}`}>
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
  );
}

interface SettingsAdvancedProps { form: Settings; onPatch: (patch: Partial<Settings>) => void; paths: PathInfo[]; backupsEpoch: number; onOpenPath: (item: PathInfo) => void; onRefresh: () => Promise<void>; }

export function SettingsAdvanced({ form, onPatch, paths, backupsEpoch, onOpenPath, onRefresh }: SettingsAdvancedProps) {
  const feedback = useFeedback();
  const { t } = useTranslation("settings");
  const autoBackupOptions = [{ label: t("backup.off"), value: 0 }, { label: t("backup.interval6h"), value: 6 }, { label: t("backup.interval12h"), value: 12 }, { label: t("backup.interval24h"), value: 24 }, { label: t("backup.interval48h"), value: 48 }, { label: t("backup.interval7d"), value: 168 }];
  const keepOptions = [3, 5, 10, 15, 20, 30].map((value) => ({ label: t("backup.keepCount", { count: value }), value }));
  const [backups, setBackups] = useState<DatabaseBackupInfo[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DatabaseBackupInfo | null>(null);
  const [renameText, setRenameText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [backupOpen, setBackupOpen] = useState(true);

  const loadBackups = async () => { try { setBackups(await api.listDatabaseBackups()); } catch { setBackups([]); } };
  useEffect(() => { void loadBackups(); }, [backupsEpoch]);

  const exportBackupToFile = async () => {
    if (exporting) return;
    setExporting(true);
    try { let directory: string | null = null; if (isTauri) { const result = await openDialog({ title: t("backup.pickExportDir"), directory: true, multiple: false }); directory = typeof result === "string" ? result : null; if (!directory) return; } await api.exportDatabaseTo(directory ?? "mock-export"); feedback.success(t("backup.toastExported")); }
    catch (error) { feedback.error(String(error)); }
    finally { setExporting(false); }
  };
  const importBackupFromFile = async () => {
    if (importing) return;
    try { let picked: string | null = null; if (isTauri) { const result = await openDialog({ title: t("backup.pickImportFile"), multiple: false, filters: [{ name: t("backup.sqliteFilter"), extensions: ["db"] }] }); picked = typeof result === "string" ? result : null; if (!picked) return; } setImporting(true); await api.importDatabase(picked ?? "mock-backup.db"); feedback.success(t("backup.toastImported")); await onRefresh(); await loadBackups(); }
    catch (error) { feedback.error(String(error)); }
    finally { setImporting(false); }
  };
  const createImmediateBackup = async () => { if (exporting) return; setExporting(true); try { await api.exportDatabase(); feedback.success(t("backup.toastCreated")); await loadBackups(); } catch (error) { feedback.error(String(error)); } finally { setExporting(false); } };
  const openRename = (backup: DatabaseBackupInfo) => { setRenameTarget(backup); setRenameText(backupTitle(backup.name)); };
  const submitRename = async () => { const target = renameTarget; const text = renameText.trim(); if (!target || renaming || !text || text === backupTitle(target.name)) { setRenameTarget(null); return; } setRenaming(true); try { await api.renameDatabaseBackup(target.name, text); feedback.success(t("backup.toastRenamed")); await loadBackups(); setRenameTarget(null); } catch (error) { feedback.error(String(error)); } finally { setRenaming(false); } };
  const restoreBackup = async (backup: DatabaseBackupInfo) => { if (!await feedback.confirm({ title: t("backup.restoreConfirmTitle"), description: t("backup.restoreConfirm", { name: backup.name }), confirmText: t("backup.restore"), destructive: true })) return; try { await api.restoreDatabase(backup.name); feedback.success(t("backup.toastRestored")); await onRefresh(); await loadBackups(); } catch (error) { feedback.error(String(error)); } };
  const deleteBackup = async (backup: DatabaseBackupInfo) => { if (!await feedback.confirm({ title: t("backup.deleteConfirmTitle"), description: <Trans ns="settings" i18nKey="backup.deleteConfirm" values={{ name: backup.name }} components={{ strong: <strong /> }} />, confirmText: t("backup.delete"), destructive: true })) return; try { await api.deleteDatabaseBackup(backup.name); feedback.success(t("backup.toastDeleted")); await loadBackups(); } catch (error) { feedback.error(String(error)); } };

  return (
    <div className="apple-group mt-[var(--gap-section)]">
      <section className="apple-panel-section">
        <AppDisclosure
          open={backupOpen}
          onOpenChange={setBackupOpen}
          summary={(
            <>
              <span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl text-accent">
                <Database className="h-[18px] w-[18px]" strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span className="setting-title block">{t("backup.title")}</span>
                <span className="setting-description mt-0.5 block">{t("backup.description")}</span>
              </span>
            </>
          )}
        >
          <div className="border-t border-[var(--panel-divider)] pt-4">
                <div className="title-sm">{t("backup.actionsTitle")}</div>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <button type="button" className="apple-action-button" disabled={exporting} onClick={() => void createImmediateBackup()}>
                    <Save className="h-4 w-4 text-accent" strokeWidth={2} />
                    {t("backup.createNow")}
                  </button>
                  <button type="button" className="apple-action-button" onClick={() => { const item = paths.find((path) => path.label === BACKUP_DIR_LABEL); if (item) onOpenPath(item); else feedback.warning(t("backup.toastFolderMissing")); }}>
                    <FolderOpen className="h-4 w-4 text-[var(--warning)]" strokeWidth={2} />
                    {t("backup.folder")}
                  </button>
                  <button type="button" className="apple-action-button" disabled={importing} onClick={() => void importBackupFromFile()}>
                    <Download className="h-4 w-4 text-accent" strokeWidth={2} />
                    {t("backup.import")}
                  </button>
                  <button type="button" className="apple-action-button" disabled={exporting} onClick={() => void exportBackupToFile()}>
                    <Upload className="h-4 w-4 text-success" strokeWidth={2} />
                    {t("backup.export")}
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="field-label muted mb-1.5">{t("backup.autoLabel")}</div>
                    <AppSelect value={form.auto_backup_interval_hours} options={autoBackupOptions} onChange={(value) => onPatch({ auto_backup_interval_hours: value })} />
                  </div>
                  <div>
                    <div className="field-label muted mb-1.5">{t("backup.keepLabel")}</div>
                    <AppSelect value={form.database_backup_keep_count} options={keepOptions} onChange={(value) => onPatch({ database_backup_keep_count: value })} />
                  </div>
                </div>
              </div>
              <div className="mt-4 border-t border-[var(--panel-divider)] pt-4">
                <div className="setting-title">{t("backup.recordsTitle")}</div>
                {backups.length ? (
                  <div className="mt-2 space-y-2">
                    {backups.map((backup) => (
                      <div key={backup.name} className="apple-list-row">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="settings-icon-tile grid h-8 w-8 shrink-0 place-items-center rounded-lg text-accent">
                            <Database className="h-4 w-4" strokeWidth={2} />
                          </span>
                          <div className="min-w-0">
                            <div className="mono truncate text-xs font-medium">{backup.name}</div>
                            <div className="muted meta-xs">{formatTimestamp(backup.created_at)} · {formatSize(backup.size_bytes)}</div>
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1.5">
                          <button type="button" className="apple-icon-button text-[var(--text-secondary)] hover:text-accent" title={t("backup.renameTooltip")} onClick={() => openRename(backup)}>
                            <Pencil className="h-4 w-4" strokeWidth={2} />
                          </button>
                          <button type="button" className="apple-icon-button text-accent" title={t("backup.restoreTooltip")} onClick={() => void restoreBackup(backup)}>
                            <DatabaseBackup className="h-4 w-4" strokeWidth={2} />
                          </button>
                          <button type="button" className="apple-icon-button text-[var(--danger)]/70" title={t("backup.deleteTooltip")} onClick={() => void deleteBackup(backup)}>
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="setting-description mt-2 flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    {t("backup.empty")}
                  </div>
                )}
              </div>
        </AppDisclosure>
      </section>
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
  const { update, checking, installing, check, install } = useAppUpdate();
  const openRepository = () => void api.openUrl("https://github.com/zeno528/CGSwitch").catch((error) => feedback.error(String(error)));
  // 检查只负责发现并展示版本号，升级必须由用户点击「立即升级」触发
  const checkUpdate = async () => {
    try {
      const found = await check();
      if (!found) feedback.success(t("about.upToDate"));
    } catch (error) {
      feedback.error(updateFailureMessage(error, tUpdate));
    }
  };

  return (
    <div className="apple-group mt-[var(--gap-section)] p-[var(--gap-card)]">
      <div className="settings-about__hero brand-gradient-surface">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="flex items-center gap-3">
            <img src="/logo.svg" alt="CGswitch" className="app-logo h-14 w-14 shrink-0" />
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
          <button type="button" className="apple-action-button" disabled={checking} onClick={() => void checkUpdate()}>
            <RefreshCw className={`h-4 w-4 ${checking ? "animate-spin" : ""}`} strokeWidth={2} />
            {t("about.checkUpdate")}
          </button>
          </div>
        </div>
        {update ? (
          <div className="update-available-reveal mt-3">
            <div className="update-available-card">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success text-[var(--panel-bg)]">
                  <Download className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
                </span>
                <span className="font-medium">{t("about.updateAvailable", { version: update.version })}</span>
              </div>
              <button type="button" className="apple-action-button app-button--primary h-8 px-3" disabled={installing} onClick={() => void install()}>
                {installing ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" strokeWidth={2} aria-hidden="true" /> : null}
                {installing ? t("about.installing") : t("about.updateNow")}
              </button>
            </div>
          </div>
        ) : null}
        <hr className="my-4 border-0 border-t border-[var(--panel-divider)]" />
      </div>
      <h2 className="setting-title">{t("about.dataAndPaths")}</h2>
      <div className="mt-2 divide-y divide-[var(--panel-divider)] overflow-hidden rounded-[var(--radius-control)] border border-[var(--panel-ring)]">
        {paths.filter((item) => item.label !== BACKUP_DIR_LABEL).map((item) => (
          <button key={item.label} type="button" className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-black/5 disabled:opacity-40 dark:hover:bg-white/8" disabled={Boolean(openingPath)} title={t("about.openPath", { label: item.label })} onClick={() => onOpenPath(item)}>
            <span className="shrink-0 text-sm font-medium">{item.label}</span>
            <span className="mono muted meta-xs min-w-0 flex-1 truncate" title={item.path}>{item.path.replace(/^\/(Users|home)\/[^/]+/, "~")}</span>
            {openingPath === item.path ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-accent" strokeWidth={2} /> : <FolderOpen className="h-4 w-4 shrink-0 text-[var(--text-secondary)]" strokeWidth={2} />}
          </button>
        ))}
      </div>
    </div>
  );
}
