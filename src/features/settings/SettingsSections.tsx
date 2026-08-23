import { ChevronRight, Database, DatabaseBackup, Download, FolderOpen, LoaderCircle, Moon, MoonStar, Monitor, PanelBottomClose, Pencil, Power, Save, Sun, Upload } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useState } from "react";
import { api, isTauri } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { AppDialog } from "../../components/AppDialog";
import { AppSelect } from "../../components/AppSelect";
import { AppSwitch } from "../../components/AppSwitch";
import { TrashIcon } from "../../components/TrashIcon";
import type { DatabaseBackupInfo, PathInfo, Settings } from "../../types";
import version from "../../../VERSION?raw";

const themeOptions = [{ label: "跟随系统", value: "system" as const }, { label: "浅色", value: "light" as const }, { label: "深色", value: "dark" as const }];
const autoBackupOptions = [{ label: "关闭", value: 0 }, { label: "6 小时", value: 6 }, { label: "12 小时", value: 12 }, { label: "24 小时", value: 24 }, { label: "48 小时", value: 48 }, { label: "7 天", value: 168 }];
const keepOptions = [3, 5, 10, 15, 20, 30].map((value) => ({ label: `${value} 个`, value }));

export const backupTitle = (name: string) => name.replace(/^(?:cg-backup-|cgswitch-export-)/, "").replace(/\.db$/, "");
export const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(2)} MB`;
export const formatTimestamp = (seconds: number) => { const date = new Date(seconds * 1000); const pad = (value: number) => String(value).padStart(2, "0"); return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`; };

interface SettingsGeneralProps { form: Settings; onPatch: (patch: Partial<Settings>) => void; }

export function SettingsGeneral({ form, onPatch }: SettingsGeneralProps) {
  return <div className="apple-group mt-[var(--gap-section)] p-[var(--gap-card)]"><div className="setting-title mb-2">主题</div><div className="apple-group inline-flex gap-1 p-1">{themeOptions.map((option) => <button key={option.value} type="button" className={`inline-flex h-9 w-28 items-center justify-center gap-1.5 rounded-xl text-sm transition-colors ${form.theme === option.value ? "bg-[var(--selection-bg)] font-semibold text-accent" : "font-medium hover:bg-black/5 dark:hover:bg-white/8"}`} aria-pressed={form.theme === option.value} onClick={() => onPatch({ theme: option.value })}>{option.value === "system" ? <Monitor className="h-4 w-4" strokeWidth={2} /> : option.value === "light" ? <Sun className="h-4 w-4" strokeWidth={2} /> : <Moon className="h-4 w-4" strokeWidth={2} />}{option.label}</button>)}</div><hr className="my-4 border-0 border-t border-[var(--panel-divider)]" /><div className="flex flex-col gap-5">{[["autostart_enabled", "开机自启", "登录系统后自动启动 CGswitch", Power, "text-accent"], ["silent_start", "静默启动", "启动时不显示主窗口，驻留系统托盘", MoonStar, "text-[var(--lavender)]"], ["minimize_to_tray", "关闭时最小化到托盘", "点击关闭按钮时隐藏到托盘而不是退出", PanelBottomClose, "text-[var(--warning)]"]].map(([key, label, description, Icon, color]) => <div key={String(key)} className="flex items-center justify-between gap-4"><div className="flex items-start gap-3"><span className={`settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl ${String(color)}`}><Icon className="h-[18px] w-[18px]" strokeWidth={2} /></span><div><div className="setting-title">{String(label)}</div><div className="setting-description mt-0.5">{String(description)}</div></div></div><AppSwitch checked={Boolean(form[key as keyof Settings])} onCheckedChange={(value) => onPatch({ [String(key)]: value })} /></div>)}</div></div>;
}

interface SettingsAdvancedProps { form: Settings; onPatch: (patch: Partial<Settings>) => void; paths: PathInfo[]; backupsEpoch: number; onOpenPath: (item: PathInfo) => void; onRefresh: () => Promise<void>; }

export function SettingsAdvanced({ form, onPatch, paths, backupsEpoch, onOpenPath, onRefresh }: SettingsAdvancedProps) {
  const feedback = useFeedback();
  const [backups, setBackups] = useState<DatabaseBackupInfo[]>([]);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [renameTarget, setRenameTarget] = useState<DatabaseBackupInfo | null>(null);
  const [renameText, setRenameText] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);

  const loadBackups = async () => { try { setBackups(await api.listDatabaseBackups()); } catch { setBackups([]); } };
  useEffect(() => { void loadBackups(); }, [backupsEpoch]);

  const exportBackupToFile = async () => {
    if (exporting) return;
    setExporting(true);
    try { let directory: string | null = null; if (isTauri) { const result = await openDialog({ title: "选择导出目录", directory: true, multiple: false }); directory = typeof result === "string" ? result : null; if (!directory) return; } const path = await api.exportDatabaseTo(directory ?? "mock-export"); feedback.success(`数据文件已导出：${path}`); }
    catch (error) { feedback.error(String(error)); }
    finally { setExporting(false); }
  };
  const importBackupFromFile = async () => {
    if (importing) return;
    try { let picked: string | null = null; if (isTauri) { const result = await openDialog({ title: "选择数据库文件", multiple: false, filters: [{ name: "SQLite 数据库", extensions: ["db"] }] }); picked = typeof result === "string" ? result : null; if (!picked) return; } setImporting(true); await api.importDatabase(picked ?? "mock-backup.db"); feedback.success("数据库已导入并恢复"); await onRefresh(); await loadBackups(); }
    catch (error) { feedback.error(String(error)); }
    finally { setImporting(false); }
  };
  const createImmediateBackup = async () => { if (exporting) return; setExporting(true); try { await api.exportDatabase(); feedback.success("已创建内部备份"); await loadBackups(); } catch (error) { feedback.error(String(error)); } finally { setExporting(false); } };
  const openRename = (backup: DatabaseBackupInfo) => { setRenameTarget(backup); setRenameText(backupTitle(backup.name)); };
  const submitRename = async () => { const target = renameTarget; const text = renameText.trim(); if (!target || renaming || !text || text === backupTitle(target.name)) { setRenameTarget(null); return; } setRenaming(true); try { await api.renameDatabaseBackup(target.name, text); feedback.success("备份已重命名"); await loadBackups(); setRenameTarget(null); } catch (error) { feedback.error(String(error)); } finally { setRenaming(false); } };
  const restoreBackup = async (backup: DatabaseBackupInfo) => { if (!await feedback.confirm({ title: "恢复数据库备份", description: `确定用「${backup.name}」覆盖当前所有供应商数据吗？恢复后无法撤销。备份中的 MCP 配置会一并写回 ~/.codex/config.toml（覆盖当前 MCP 段）。`, confirmText: "恢复", destructive: true })) return; try { await api.restoreDatabase(backup.name); feedback.success("数据库已恢复"); await onRefresh(); await loadBackups(); } catch (error) { feedback.error(String(error)); } };
  const deleteBackup = async (backup: DatabaseBackupInfo) => { if (!await feedback.confirm({ title: "删除数据库备份", description: <>确定删除「<strong>{backup.name}</strong>」吗？删除后不可恢复。</>, confirmText: "删除", destructive: true })) return; try { await api.deleteDatabaseBackup(backup.name); feedback.success("备份已删除"); await loadBackups(); } catch (error) { feedback.error(String(error)); } };

  return (
    <div className="apple-group mt-[var(--gap-section)]">
      <div className={`apple-disclosure ${backupOpen ? "apple-disclosure--open" : ""}`}>
        <section className="apple-panel-section">
          <button type="button" className="apple-disclosure__summary" aria-expanded={backupOpen} onClick={() => setBackupOpen((open) => !open)}>
            <span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-xl text-accent">
              <Database className="h-[18px] w-[18px]" strokeWidth={2} />
            </span>
            <span className="min-w-0">
              <span className="setting-title block">数据备份</span>
              <span className="setting-description mt-0.5 block">管理本地数据库备份，支持导入、导出和自动备份</span>
            </span>
            <ChevronRight className="apple-disclosure__icon ml-auto" size={18} strokeWidth={2} aria-hidden="true" />
          </button>
          <div className="apple-disclosure__content" aria-hidden={!backupOpen} inert={!backupOpen}>
            <div className="apple-disclosure__body">
              <div className="border-t border-[var(--panel-divider)] pt-4">
                <div className="title-sm">备份操作</div>
                <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <button type="button" className="apple-action-button" disabled={exporting} onClick={() => void createImmediateBackup()}>
                    <Save className="h-4 w-4 text-accent" strokeWidth={2} />
                    立即备份
                  </button>
                  <button type="button" className="apple-action-button" onClick={() => { const item = paths.find((path) => path.label === "备份目录"); if (item) onOpenPath(item); else feedback.warning("找不到备份目录"); }}>
                    <FolderOpen className="h-4 w-4 text-[var(--warning)]" strokeWidth={2} />
                    备份文件夹
                  </button>
                  <button type="button" className="apple-action-button" disabled={importing} onClick={() => void importBackupFromFile()}>
                    <Download className="h-4 w-4 text-accent" strokeWidth={2} />
                    导入数据库
                  </button>
                  <button type="button" className="apple-action-button" disabled={exporting} onClick={() => void exportBackupToFile()}>
                    <Upload className="h-4 w-4 text-success" strokeWidth={2} />
                    导出数据库
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3">
                  <div>
                    <div className="field-label muted mb-1.5">自动备份</div>
                    <AppSelect value={form.auto_backup_interval_hours} options={autoBackupOptions} onChange={(value) => onPatch({ auto_backup_interval_hours: value })} />
                  </div>
                  <div>
                    <div className="field-label muted mb-1.5">最多保留</div>
                    <AppSelect value={form.database_backup_keep_count} options={keepOptions} onChange={(value) => onPatch({ database_backup_keep_count: value })} />
                  </div>
                </div>
              </div>
              <div className="mt-4 border-t border-[var(--panel-divider)] pt-4">
                <div className="setting-title">备份记录</div>
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
                          <button type="button" className="apple-icon-button text-[var(--text-secondary)] hover:text-accent" title="编辑备份名称" onClick={() => openRename(backup)}>
                            <Pencil className="h-4 w-4" strokeWidth={2} />
                          </button>
                          <button type="button" className="apple-icon-button text-accent" title="恢复数据库" onClick={() => void restoreBackup(backup)}>
                            <DatabaseBackup className="h-4 w-4" strokeWidth={2} />
                          </button>
                          <button type="button" className="apple-icon-button text-[var(--danger)]/70" title="删除备份" onClick={() => void deleteBackup(backup)}>
                            <TrashIcon />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="setting-description mt-2 flex items-center gap-2">
                    <Database className="h-4 w-4" />
                    还没有导出过备份。
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
      <AppDialog open={renameTarget !== null} onOpenChange={(open) => { if (!open) setRenameTarget(null); }} title="重命名备份" footer={<><button type="button" className="apple-action-button" onClick={() => setRenameTarget(null)}>取消</button><button type="button" className="apple-action-button app-button--primary" disabled={renaming || !renameText.trim()} onClick={() => void submitRename()}>保存</button></>}><input className="app-input" maxLength={80} placeholder="输入新的备份标题" value={renameText} onChange={(event) => setRenameText(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) void submitRename(); }} /></AppDialog>
    </div>
  );
}

interface SettingsAboutProps { paths: PathInfo[]; onOpenPath: (item: PathInfo) => void; openingPath: string | null; }

export function SettingsAbout({ paths, onOpenPath, openingPath }: SettingsAboutProps) {
  return <div className="apple-group mt-[var(--gap-section)] p-[var(--gap-card)]"><div className="flex items-center gap-3"><img src="/logo.svg" alt="CGswitch" className="h-12 w-12 shrink-0 dark:invert" /><div><div className="apple-wordmark">CGswitch</div><div className="app-version mt-1.5">版本 {version.trim()}</div></div></div><hr className="my-4 border-0 border-t border-[var(--panel-divider)]" /><h2 className="setting-title">数据与路径</h2><p className="setting-description mt-1.5">常用数据位置，点击文件夹图标即可打开。</p><div className="mt-4 grid gap-2 sm:grid-cols-3">{paths.map((item) => <div key={item.label} className="flex min-w-0 items-center justify-between gap-3 rounded-[var(--radius-control-sm)] border border-[var(--panel-ring)] px-3 py-2.5"><div className="min-w-0"><div className="text-sm font-medium">{item.label}</div><div className="mono muted meta-xs mt-0.5 truncate" title={item.path}>{item.path}</div></div><button type="button" className="apple-icon-button shrink-0 text-[var(--text-secondary)] hover:text-accent disabled:opacity-40" disabled={Boolean(openingPath)} title={`打开${item.label}`} onClick={() => onOpenPath(item)}>{openingPath === item.path ? <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} /> : <FolderOpen className="h-4 w-4" strokeWidth={2} />}</button></div>)}</div></div>;
}
