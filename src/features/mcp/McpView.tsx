import { ArrowDownUp, CircleDashed, Globe, Plus, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { getCachedMcpServers, loadMcpServers, setMcpServersCache } from "../../app/managementDataCache";
import { AppSwitch } from "../../components/AppSwitch";
import { EmptyStateCard } from "../../components/EmptyStateCard";
import { McpIcon } from "../../components/McpIcon";
import { TrashIcon } from "../../components/TrashIcon";
import { mcpTransportText } from "../../utils";
import type { McpServerSpec, McpSyncPreview } from "../../types";
import McpEdit from "./McpEdit";
import McpSyncDialog from "./McpSyncDialog";

type SyncDirection = "live-to-db" | "db-to-live";
type Transport = "http" | "stdio" | "unknown";

export default function McpView() {
  const feedback = useFeedback();
  const { t } = useTranslation("mcp");
  const cachedServers = getCachedMcpServers();
  const [servers, setServers] = useState<McpServerSpec[]>(() => cachedServers ?? []);
  const [loaded, setLoaded] = useState(cachedServers !== null);
  const [loadError, setLoadError] = useState("");
  const [editingServer, setEditingServer] = useState<McpServerSpec | null>(null);
  const [creatingServer, setCreatingServer] = useState(false);
  const [togglingName, setTogglingName] = useState("");
  const [syncPreview, setSyncPreview] = useState<McpSyncPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [syncOpen, setSyncOpen] = useState(false);
  const [applying, setApplying] = useState(false);

  const loadPreview = async () => {
    try { setSyncPreview(await api.mcpSyncPreview()); setPreviewError(""); }
    catch (error) { setPreviewError(String(error)); setSyncPreview(null); }
  };
  const refresh = async (force = false) => {
    try { setServers(await loadMcpServers(force)); setLoadError(""); }
    catch (error) { setLoadError(String(error)); }
    finally { setLoaded(true); }
    await loadPreview();
  };
  useEffect(() => { void refresh(); }, []);

  const transportOf = (server: McpServerSpec): Transport => server.url ? "http" : server.command ? "stdio" : "unknown";
  const transportIcon = (server: McpServerSpec) => { const current = transportOf(server); return current === "http" ? Globe : current === "stdio" ? Terminal : CircleDashed; };
  const metaOf = (server: McpServerSpec) => server.command ? [server.command, ...server.args.slice(0, 2)].join(" ") : server.url ?? "";

  const toggleEnabled = async (server: McpServerSpec, enabled: boolean) => {
    if (togglingName) return;
    setTogglingName(server.name);
    const previous = server.enabled;
    setServers((current) => {
      const next = current.map((item) => item.name === server.name ? { ...item, enabled: enabled ? null : false } : item);
      setMcpServersCache(next);
      return next;
    });
    try { await api.saveMcpServer(server.name, { ...server, enabled: enabled ? null : false }); }
    catch (error) { setServers((current) => { const next = current.map((item) => item.name === server.name ? { ...item, enabled: previous } : item); setMcpServersCache(next); return next; }); feedback.error(String(error)); }
    finally { setTogglingName(""); }
  };

  const removeServer = async (server: McpServerSpec) => {
    const confirmed = await feedback.confirm({ title: t("confirm.deleteTitle"), description: <Trans ns="mcp" i18nKey="confirm.deleteDescription" values={{ name: server.name }} components={{ strong: <strong /> }} />, confirmText: t("confirm.delete"), destructive: true });
    if (!confirmed) return;
    try { await api.deleteMcpServer(server.name); feedback.success(t("feedback.deleted")); await refresh(true); }
    catch (error) { feedback.error(String(error)); }
  };

  const openSyncDialog = () => {
    if (applying) return;
    if (previewError) { setSyncOpen(true); return; }
    if (syncPreview && syncPreview.entries.length === 0) { feedback.info(t("feedback.inSync")); return; }
    setSyncOpen(true);
  };
  const onApply = async (direction: SyncDirection) => {
    if (applying) return;
    setApplying(true);
    try {
      if (direction === "live-to-db") { const count = await api.importMcpFromLive(); feedback.success(t("feedback.importedFromLive", { count })); }
      else { const count = await api.restoreMcpFromDatabase(); feedback.success(t("feedback.restoredToLive", { count })); }
      setSyncOpen(false);
      await refresh(true);
    } catch (error) { feedback.error(String(error)); }
    finally { setApplying(false); }
  };

  if (editingServer || creatingServer) return <McpEdit server={editingServer} create={creatingServer} onBack={() => { setEditingServer(null); setCreatingServer(false); void refresh(true); }} />;
  return <section className="apple-scroll-page mx-auto w-full max-w-none"><header className="apple-page-bar flex-wrap justify-between gap-4"><div className="flex min-w-0 items-center gap-2.5"><span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-accent"><McpIcon className="h-[22px] w-[22px]" /></span><div className="flex items-center gap-2"><div className="apple-title">{t("list.title")}</div>{loaded ? <span className="apple-chip" aria-label={t("list.serverCount", { count: servers.length })}>{servers.length}</span> : null}</div></div><div className="flex w-full max-w-md items-center justify-end gap-2"><button type="button" className="apple-action-button" disabled={applying} onClick={openSyncDialog}><ArrowDownUp className="h-4 w-4" strokeWidth={2} />{t("list.resolveDiff")}</button><button type="button" className="apple-action-button app-button--primary" onClick={() => setCreatingServer(true)}><Plus className="h-4 w-4" strokeWidth={2} />{t("list.addServer")}</button></div></header><div className="apple-edit-content">{loadError ? <p className="muted mt-4 text-sm">{loadError}{loaded ? t("list.loadErrorHint") : ""}</p> : null}<div>{syncPreview && syncPreview.entries.length ? <div className="apple-list-row mb-2"><span className="flex min-w-0 items-center gap-2"><span className="apple-chip chip-warn">{t("list.diffChip")}</span><span className="muted truncate text-sm">{t("list.diffSummary", { count: syncPreview.entries.length })}</span></span><button type="button" className="apple-inline-btn" onClick={openSyncDialog}>{t("list.reviewDiff")}</button></div> : null}{!servers.length ? <EmptyStateCard loading={!loaded} icon={<McpIcon className="h-5 w-5" />}><p className="muted">{t("empty.description")}</p></EmptyStateCard> : servers.length ? <div className="space-y-2">{servers.map((server) => { const Icon = transportIcon(server); return <div key={server.name} className="apple-list-row"><button type="button" className="group flex min-w-0 cursor-pointer items-center gap-2.5 text-left" aria-label={t("list.editServerAria", { name: server.name })} title={t("list.clickToEdit")} onClick={() => setEditingServer(server)}><span className="settings-icon-tile grid h-8 w-8 shrink-0 place-items-center rounded-lg text-accent transition-colors group-hover:bg-(--selection-bg)"><Icon className="h-4 w-4" strokeWidth={2} /></span><div className="min-w-0"><div className="flex items-center gap-2"><span className="min-w-0 truncate font-semibold transition-colors group-hover:text-accent">{server.name}</span><span className="shrink-0 rounded-md bg-black/5 px-1.5 py-px text-[10px] font-medium tracking-wide muted dark:bg-white/10">{mcpTransportText(server, t)}</span></div><div className="mono muted meta-xs truncate">{metaOf(server)}</div></div></button><div className="flex shrink-0 items-center gap-1.5"><AppSwitch size="sm" checked={server.enabled !== false} label={t("list.enableServer", { name: server.name })} onCheckedChange={(value) => void toggleEnabled(server, value)} /><button type="button" className="apple-icon-button text-[var(--danger)]/70 hover:bg-(--danger)/10 hover:text-[var(--danger)]" title={t("list.delete")} aria-label={t("list.deleteServerAria", { name: server.name })} onClick={() => void removeServer(server)}><TrashIcon /></button></div></div>; })}</div> : null}</div></div><McpSyncDialog open={syncOpen} preview={syncPreview} previewError={previewError} busy={applying} onClose={() => setSyncOpen(false)} onApply={(direction) => void onApply(direction)} /></section>;
}
