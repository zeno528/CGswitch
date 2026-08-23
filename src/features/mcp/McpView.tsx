import { ArrowDownUp, CircleDashed, Globe, Plus, Terminal } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { AppSwitch } from "../../components/AppSwitch";
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
  const [servers, setServers] = useState<McpServerSpec[]>([]);
  const [loaded, setLoaded] = useState(false);
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
  const refresh = async () => {
    try { setServers(await api.listMcpServers()); setLoadError(""); }
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
    setServers((current) => current.map((item) => item.name === server.name ? { ...item, enabled: enabled ? null : false } : item));
    try { await api.saveMcpServer(server.name, { ...server, enabled: enabled ? null : false }); }
    catch (error) { setServers((current) => current.map((item) => item.name === server.name ? { ...item, enabled: previous } : item)); feedback.error(String(error)); }
    finally { setTogglingName(""); }
  };

  const removeServer = async (server: McpServerSpec) => {
    const confirmed = await feedback.confirm({ title: "删除 MCP 服务器", description: <>确定删除“<strong>{server.name}</strong>”吗？~/.codex/config.toml 中对应的配置段将被移除。</>, confirmText: "删除", destructive: true });
    if (!confirmed) return;
    try { await api.deleteMcpServer(server.name); feedback.success("MCP 服务器已删除"); await refresh(); }
    catch (error) { feedback.error(String(error)); }
  };

  const openSyncDialog = () => {
    if (applying) return;
    if (previewError) { setSyncOpen(true); return; }
    if (syncPreview && syncPreview.entries.length === 0) { feedback.info("数据库中的 MCP 配置与 config.toml 一致，无需处理"); return; }
    setSyncOpen(true);
  };
  const onApply = async (direction: SyncDirection) => {
    if (applying) return;
    setApplying(true);
    try {
      if (direction === "live-to-db") { const count = await api.importMcpFromLive(); feedback.success(`已用 config.toml 覆盖数据库中的 MCP 配置，共 ${count} 台服务器`); }
      else { const count = await api.restoreMcpFromDatabase(); feedback.success(`已用数据库中的 MCP 配置覆盖 config.toml，共 ${count} 台服务器`); }
      setSyncOpen(false);
      await refresh();
    } catch (error) { feedback.error(String(error)); }
    finally { setApplying(false); }
  };

  if (editingServer || creatingServer) return <McpEdit server={editingServer} create={creatingServer} onBack={() => { setEditingServer(null); setCreatingServer(false); void refresh(); }} />;
  return <section className="apple-scroll-page mx-auto w-full max-w-none"><header className="apple-page-bar flex-wrap justify-between gap-4"><div className="flex min-w-0 items-center gap-2.5"><span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-accent"><McpIcon className="h-[22px] w-[22px]" /></span><div className="flex items-center gap-2"><div className="apple-title">MCP 服务器管理</div>{loaded ? <span className="apple-chip" aria-label={`${servers.length} 台服务器`}>{servers.length}</span> : null}</div></div><div className="flex w-full max-w-md items-center justify-end gap-2"><button type="button" className="apple-action-button" disabled={applying} onClick={openSyncDialog}><ArrowDownUp className="h-4 w-4" strokeWidth={2} />处理配置差异</button><button type="button" className="apple-action-button app-button--primary" onClick={() => setCreatingServer(true)}><Plus className="h-4 w-4" strokeWidth={2} />添加服务器</button></div></header><div className="apple-edit-content">{loadError ? <p className="muted mt-4 text-sm">{loadError}{loaded ? "config.toml 无法解析时，可点「处理配置差异」用数据库中的 MCP 配置恢复。" : ""}</p> : null}<div>{syncPreview && syncPreview.entries.length ? <div className="apple-list-row mb-2"><span className="flex min-w-0 items-center gap-2"><span className="apple-chip chip-warn">MCP 差异</span><span className="muted truncate text-sm">数据库与 config.toml 有 {syncPreview.entries.length} 项 MCP 配置不同</span></span><button type="button" className="apple-inline-btn" onClick={openSyncDialog}>查看并处理</button></div> : null}{loaded && servers.length === 0 ? <div className="apple-group py-14 text-center"><p className="muted">还没有 MCP 服务器。点击“添加服务器”把第一个 MCP 服务写进 config.toml。</p></div> : servers.length ? <div className="space-y-2">{servers.map((server) => { const Icon = transportIcon(server); return <div key={server.name} className="apple-list-row"><button type="button" className="group flex min-w-0 cursor-pointer items-center gap-2.5 text-left" aria-label={`编辑 ${server.name}`} title="点击编辑" onClick={() => setEditingServer(server)}><span className="settings-icon-tile grid h-8 w-8 shrink-0 place-items-center rounded-lg text-accent transition-colors group-hover:bg-[var(--selection-bg)]"><Icon className="h-4 w-4" strokeWidth={2} /></span><div className="min-w-0"><div className="flex items-center gap-2"><span className="min-w-0 truncate font-semibold transition-colors group-hover:text-accent">{server.name}</span><span className="shrink-0 rounded-md bg-black/5 px-1.5 py-px text-[10px] font-medium tracking-wide muted dark:bg-white/10">{mcpTransportText(server)}</span></div><div className="mono muted meta-xs truncate">{metaOf(server)}</div></div></button><div className="flex shrink-0 items-center gap-1.5"><AppSwitch size="sm" checked={server.enabled !== false} label={`启用 ${server.name}`} onCheckedChange={(value) => void toggleEnabled(server, value)} /><button type="button" className="apple-icon-button text-[var(--danger)]/70 hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]" title="删除" aria-label={`删除 ${server.name}`} onClick={() => void removeServer(server)}><TrashIcon /></button></div></div>; })}</div> : null}</div></div><McpSyncDialog open={syncOpen} preview={syncPreview} previewError={previewError} busy={applying} onClose={() => setSyncOpen(false)} onApply={(direction) => void onApply(direction)} /></section>;
}
