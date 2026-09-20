import { CircleDashed, GitCompare, Globe, Pencil, Plus, Terminal, Wifi, Wrench } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Trans, useTranslation } from "react-i18next";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { deleteCachedMcpProbe, getCachedMcpProbe, getCachedMcpServers, loadMcpServers, setCachedMcpProbe, setMcpServersCache } from "../../app/managementDataCache";
import { AppSwitch } from "../../components/AppSwitch";
import { EmptyStateCard } from "../../components/EmptyStateCard";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { McpIcon } from "../../components/McpIcon";
import { mcpTransportText } from "../../utils";
import type { McpDiffEntryAction, McpProbeResult, McpServerSpec, McpSyncDiffEntry, McpSyncPreview } from "../../types";
import McpDiffPage from "./McpDiffPage";
import McpEdit from "./McpEdit";

type Transport = "http" | "stdio" | "unknown";

export type McpDiffVerb = "adopt" | "revert";

/// 差异动作：只指向单个条目的单侧（mirror=数据库镜像，live=config.toml）；
/// fragment 为空表示删除该侧的条目。
export type McpDiffAction = { side: "mirror" | "live" } & McpDiffEntryAction;

/// 差异×动词到外科手术原语的唯一映射——每条命令只碰单个条目的单侧（镜像或 live），
/// 不得使用 saveMcpServer/deleteMcpServer（它们会用整段 live 重建镜像，殃及其他未处理差异）：
/// 同步 = 采纳外部修改（live 片段写入镜像；外部已删除的删除镜像条目）；
/// 撤销 = 回退外部修改（数据库片段写回 live；外部新增的从 live 移除）。
export function mcpEntryAction(entry: McpSyncDiffEntry, verb: McpDiffVerb): McpDiffAction | null {
  if (verb === "adopt") {
    if (entry.kind === "db_only") return { side: "mirror", name: entry.name, fragment: null };
    return entry.live_toml ? { side: "mirror", name: entry.name, fragment: entry.live_toml } : null;
  }
  if (entry.kind === "live_only") return { side: "live", name: entry.name, fragment: null };
  return entry.db_toml ? { side: "live", name: entry.name, fragment: entry.db_toml } : null;
}

function mcpServerFingerprint(server: McpServerSpec) {
  const { enabled, startup_timeout_sec, tool_timeout_sec, ...connection } = server;
  let hash = 2166136261;
  for (const char of JSON.stringify(connection)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  // ponytail: 非加密哈希只用于缓存键；若未来要求抗碰撞，再换 Web Crypto。
  return (hash >>> 0).toString(36);
}

function cachedProbeState(servers: McpServerSpec[]) {
  const results: Record<string, McpProbeResult> = {};
  const toolsLoaded: Record<string, boolean> = {};
  for (const server of servers) {
    const entry = getCachedMcpProbe(server.name, mcpServerFingerprint(server));
    if (!entry) continue;
    results[server.name] = entry.result;
    if (entry.toolsLoaded) toolsLoaded[server.name] = true;
  }
  return { results, toolsLoaded };
}

function transportOf(server: McpServerSpec): Transport { return server.url ? "http" : server.command ? "stdio" : "unknown"; }

/// 列表排序：类型分组（stdio 本地 → http 远程 → unknown 兜底）优先，组内按名称。
const transportOrder: Record<Transport, number> = { stdio: 0, http: 1, unknown: 2 };

export function compareMcpServers(left: McpServerSpec, right: McpServerSpec): number {
  return transportOrder[transportOf(left)] - transportOrder[transportOf(right)] || left.name.localeCompare(right.name);
}
function transportIcon(server: McpServerSpec) { const current = transportOf(server); return current === "http" ? Globe : current === "stdio" ? Terminal : CircleDashed; }
function metaOf(server: McpServerSpec) { return server.command ? [server.command, ...server.args.slice(0, 2)].join(" ") : server.url ?? ""; }

function McpToolsPanel({ result }: { result: McpProbeResult }) {
  const { t } = useTranslation("mcp");

  return (
    <div className="px-3 pb-3 pt-1">
      <div className="flex flex-wrap gap-1.5">
        {result.tools.map((tool) => (
          <code key={tool.name} className="apple-chip mono">{tool.name}</code>
        ))}
        {!result.tools.length ? <p className="muted meta-xs">{t("list.noTools")}</p> : null}
      </div>
    </div>
  );
}

/** 行内元信息小 chip：传输类型 / 版本 / 工具数共用同一形态。 */
function MetaChip({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded-md bg-black/5 px-1.5 py-px text-[10px] font-medium tracking-wide muted dark:bg-white/10">{children}</span>;
}

type McpServerRowProps = {
  server: McpServerSpec;
  result: McpProbeResult | undefined;
  probing: boolean;
  detailsVisible: boolean;
  toolsBusy: boolean;
  toolsLoaded: boolean;
  onEdit: (server: McpServerSpec) => void;
  onProbe: (server: McpServerSpec) => void;
  onToggleTools: (server: McpServerSpec) => void;
  onToggleEnabled: (server: McpServerSpec, enabled: boolean) => void;
};

function McpServerRow({ server, result, probing, detailsVisible, toolsBusy, toolsLoaded, onEdit, onProbe, onToggleTools, onToggleEnabled }: McpServerRowProps) {
  const { t } = useTranslation("mcp");
  const Icon = transportIcon(server);

  return (
    <div className="apple-group" onClick={(event) => {
      if (!detailsVisible || !(event.target instanceof HTMLElement) || event.target.closest('button, input, code, [role="switch"]')) return;
      onToggleTools(server);
    }}>
      <div className="apple-list-row mcp-expanded-card__header">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="settings-icon-tile grid h-8 w-8 shrink-0 place-items-center rounded-lg text-accent">
            <Icon className="h-4 w-4" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${result?.ok ? "bg-success" : "bg-(--text-secondary)"}`}
                role="img"
                aria-label={t(probing ? "list.connectionStateChecking" : result?.ok ? "list.connectionStateConnected" : "list.connectionStateUnavailable")}
              />
              <span className="min-w-0 truncate font-semibold">{server.name}</span>
              <MetaChip>{mcpTransportText(server, t)}</MetaChip>
              {result?.server_info?.version ? <MetaChip>{result.server_info.version}</MetaChip> : null}
              {toolsLoaded ? <MetaChip>{t("list.toolCount", { count: result?.tools.length ?? 0 })}</MetaChip> : null}
              {toolsBusy ? <span className="muted shrink-0"><LoadingSpinner /></span> : null}
            </div>
            <div className="mono muted meta-xs truncate">{metaOf(server)}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            className="apple-icon-button text-[var(--text-secondary)] enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            title={t("list.editTooltip")}
            aria-label={t("list.editServerAria", { name: server.name })}
            onClick={() => onEdit(server)}
          >
            <Pencil className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="apple-icon-button text-[var(--text-secondary)] enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            disabled={probing}
            title={t("list.testConnection")}
            aria-label={t("list.testConnection")}
            onClick={() => onProbe(server)}
          >
            {probing ? <LoadingSpinner /> : <Wifi className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />}
          </button>
          <button
            type="button"
            className="apple-icon-button text-[var(--text-secondary)] enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
            title={t(detailsVisible ? "list.collapseTools" : "list.toolsButton")}
            aria-label={t(detailsVisible ? "list.collapseTools" : "list.toolsButton")}
            onClick={() => onToggleTools(server)}
          >
            <Wrench className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          </button>
          <AppSwitch size="sm" checked={server.enabled !== false} label={t("list.enableServer", { name: server.name })} onCheckedChange={(value) => onToggleEnabled(server, value)} />
        </div>
      </div>
      {result ? (
        <div className={`apple-disclosure mcp-tools-disclosure ${detailsVisible ? "apple-disclosure--open" : ""}`}>
          <div className="apple-disclosure__content" aria-hidden={!detailsVisible} inert={!detailsVisible}>
            <div className="apple-disclosure__body">
              <McpToolsPanel result={result} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function McpView({ activationEpoch }: { activationEpoch: number }) {
  const feedback = useFeedback();
  const { t } = useTranslation("mcp");
  const cachedServers = getCachedMcpServers();
  const [servers, setServers] = useState<McpServerSpec[]>(() => cachedServers ?? []);
  const [loaded, setLoaded] = useState(cachedServers !== null);
  const [loadError, setLoadError] = useState("");
  const [editingServer, setEditingServer] = useState<McpServerSpec | null>(null);
  const [creatingServer, setCreatingServer] = useState(false);
  const [togglingName, setTogglingName] = useState("");
  const [probingNames, setProbingNames] = useState<Record<string, boolean>>({});
  const [probeResults, setProbeResults] = useState<Record<string, McpProbeResult>>(() => cachedProbeState(cachedServers ?? []).results);
  const [toolsOpen, setToolsOpen] = useState<Record<string, boolean>>({});
  const [toolsLoading, setToolsLoading] = useState<Record<string, boolean>>({});
  const [toolsLoaded, setToolsLoaded] = useState<Record<string, boolean>>(() => cachedProbeState(cachedServers ?? []).toolsLoaded);
  const [syncPreview, setSyncPreview] = useState<McpSyncPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [diffOpen, setDiffOpen] = useState(false);
  const [resolving, setResolving] = useState(false);
  const previewInFlight = useRef(false);

  const loadPreview = async () => {
    if (previewInFlight.current) return;
    previewInFlight.current = true;
    try { setSyncPreview(await api.mcpSyncPreview()); setPreviewError(""); }
    catch (error) { setPreviewError(String(error)); setSyncPreview(null); }
    finally { previewInFlight.current = false; }
  };
  const refresh = async (force = false, skipProbeName?: string) => {
    let next: McpServerSpec[] | null = null;
    try {
      next = await loadMcpServers(force);
      setServers(next);
      const cached = cachedProbeState(next);
      setProbeResults(cached.results);
      setToolsOpen({});
      setToolsLoading({});
      setToolsLoaded(cached.toolsLoaded);
      setLoadError("");
    } catch (error) { setLoadError(String(error)); }
    finally { setLoaded(true); }
    if (next) void Promise.all(next.filter((server) => server.name !== skipProbeName).map((server) => probeServer(server, false, false)));
    await loadPreview();
    return next;
  };
  const probedOnceRef = useRef(false);
  useEffect(() => {
    // StrictMode 下 effect 双跑共用同一实例，必须用 ref 防重入，
    // 否则每次进页全量探测两遍（stdio 服务器会被拉起两次）
    if (probedOnceRef.current) return;
    probedOnceRef.current = true;
    void refresh();
  }, []);

  // 窗口激活时刷新差异预览：差异只可能来自 Codex 侧先改，激活是唯一需要重查差异的时机。
  // epoch=0 表示尚未激活过（含首次挂载，此时上面的 refresh 已经取过预览），不重复请求。
  useEffect(() => { if (activationEpoch === 0) return; void loadPreview(); }, [activationEpoch]);

  const notifyProbeFailure = (name: string, message: string) => {
    if (/(超时|timeout|timed out)/i.test(message)) feedback.warning(t("list.connectionTimeout", { name })); // i18n-exempt: 匹配后端错误原文
    else feedback.error(t("list.connectionFailed", { name }));
  };

  const toggleEnabled = async (server: McpServerSpec, enabled: boolean) => {
    if (togglingName) return;
    setTogglingName(server.name);
    const previous = server.enabled;
    setServers((current) => {
      const next = current.map((item) => item.name === server.name ? { ...item, enabled: enabled ? null : false } : item);
      setMcpServersCache(next);
      return next;
    });
    try { await api.saveMcpServer(server.name, { ...server, enabled: enabled ? null : false }); feedback.success(t("feedback.updated")); }
    catch (error) { setServers((current) => { const next = current.map((item) => item.name === server.name ? { ...item, enabled: previous } : item); setMcpServersCache(next); return next; }); feedback.error(String(error)); }
    finally { setTogglingName(""); }
  };

  const probeServer = async (server: McpServerSpec, notify = true, showLoading = notify) => {
    const fingerprint = mcpServerFingerprint(server);
    const keepTools = (result: McpProbeResult) => {
      const cached = getCachedMcpProbe(server.name, fingerprint);
      return cached?.toolsLoaded
        ? { ...result, tools: cached.result.tools, tools_truncated: cached.result.tools_truncated, tools_error: cached.result.tools_error }
        : result;
    };
    if (showLoading) setProbingNames((current) => ({ ...current, [server.name]: true }));
    try {
      const result = keepTools(await api.probeMcpServer(server.name, false, notify));
      setProbeResults((current) => ({ ...current, [server.name]: result }));
      setCachedMcpProbe(server.name, { fingerprint, result, toolsLoaded: getCachedMcpProbe(server.name, fingerprint)?.toolsLoaded ?? false });
      if (notify) {
        if (result.ok) {
          feedback.success(t("list.connectionSuccess", { name: server.name, ms: result.latency_ms ?? "-" }));
        } else notifyProbeFailure(server.name, result.error ?? "");
      }
    } catch (error) {
      const result: McpProbeResult = {
        ok: false,
        latency_ms: null,
        status: null,
        protocol_version: null,
        server_info: null,
        tools: [],
        tools_truncated: false,
        error: String(error),
        tools_error: null,
      };
      const nextResult = keepTools(result);
      setProbeResults((current) => ({ ...current, [server.name]: nextResult }));
      setCachedMcpProbe(server.name, { fingerprint, result: nextResult, toolsLoaded: getCachedMcpProbe(server.name, fingerprint)?.toolsLoaded ?? false });
      if (notify) notifyProbeFailure(server.name, String(error));
    } finally {
      if (showLoading) setProbingNames((current) => {
        const next = { ...current };
        delete next[server.name];
        return next;
      });
    }
  };

  const probeTools = async (server: McpServerSpec, showLoading = true, open = true) => {
    const name = server.name;
    if (open) setToolsOpen((current) => ({ ...current, [name]: true }));
    if (showLoading) setToolsLoading((current) => ({ ...current, [name]: true }));
    try {
      const result = await api.probeMcpServer(name, true, showLoading);
      if (!result.ok) throw new Error(result.error ?? t("list.connectionFailed", { name }));
      if (result.tools_error) throw new Error(result.tools_error);
      setProbeResults((current) => ({ ...current, [name]: result }));
      setCachedMcpProbe(name, { fingerprint: mcpServerFingerprint(server), result, toolsLoaded: true });
      setToolsLoaded((current) => ({ ...current, [name]: true }));
    } catch (error) {
      if (showLoading) feedback.error(String(error));
    } finally {
      if (showLoading) setToolsLoading((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
    }
  };

  const toggleTools = async (server: McpServerSpec) => {
    const name = server.name;
    if (toolsOpen[name]) {
      setToolsOpen((current) => ({ ...current, [name]: false }));
      return;
    }
    if (toolsLoading[name]) {
      setToolsOpen((current) => ({ ...current, [name]: true }));
      return;
    }
    void probeTools(server);
  };

  const removeServer = async (server: McpServerSpec) => {
    const confirmed = await feedback.confirm({ title: t("confirm.deleteTitle"), description: <Trans ns="mcp" i18nKey="confirm.deleteDescription" values={{ name: server.name }} components={{ strong: <strong /> }} />, confirmText: t("confirm.delete"), destructive: true });
    if (!confirmed) return;
    try { await api.deleteMcpServer(server.name); deleteCachedMcpProbe(server.name); setEditingServer(null); feedback.success(t("feedback.deleted")); await refresh(true); }
    catch (error) { feedback.error(String(error)); }
  };

  const applyDiffAction = async (action: McpDiffAction) => {
    if (action.side === "mirror") await api.setMcpMirror(action.name, action.fragment);
    else await api.revertMcpLive(action.name, action.fragment);
  };

  const resolveEntry = async (entry: McpSyncDiffEntry, verb: McpDiffVerb) => {
    if (resolving) return;
    const action = mcpEntryAction(entry, verb);
    if (!action) { feedback.error(t("diff.resolveFailed", { name: entry.name })); return; }
    setResolving(true);
    try {
      await applyDiffAction(action);
      feedback.success(t(verb === "adopt" ? "diff.adoptedToast" : "diff.revertedToast", { name: entry.name }));
      await refresh(true);
    } catch (error) { feedback.error(String(error)); }
    finally { setResolving(false); }
  };

  const resolveAll = async (verb: McpDiffVerb) => {
    if (resolving || !syncPreview?.entries.length) return;
    const entries = syncPreview.entries;
    // 整批一次提交：后端在一个文档里逐条原地改写，只备份并写盘一次；
    // 逐条调用会各备份一次，把备份保留池里操作前的那份挤掉，且中途失败会留下半完成状态
    const actions = entries
      .map((entry) => mcpEntryAction(entry, verb))
      .filter((action): action is McpDiffAction => action !== null)
      .map(({ name, fragment }) => ({ name, fragment }));
    if (!actions.length) return;
    const confirmed = await feedback.confirm({
      title: t(verb === "adopt" ? "diff.adoptAll" : "diff.revertAll"),
      description: t(verb === "adopt" ? "diff.confirmAdoptAll" : "diff.confirmRevertAll", { count: actions.length }),
      confirmText: verb === "adopt" ? t("diff.adoptAll") : t("diff.revertAll"),
      destructive: verb === "revert",
    });
    if (!confirmed) return;
    setResolving(true);
    try {
      const count = verb === "adopt"
        ? await api.setMcpMirrorEntries(actions)
        : await api.revertMcpLiveEntries(actions);
      feedback.success(t("diff.resolvedAllToast", { count }));
      await refresh(true);
    } catch (error) { feedback.error(String(error)); }
    finally { setResolving(false); }
  };

  const rebuildFromDatabase = async () => {
    if (resolving) return;
    setResolving(true);
    try {
      const count = await api.restoreMcpFromDatabase();
      feedback.success(t("feedback.restoredToLive", { count }));
      setDiffOpen(false);
      await refresh(true);
    } catch (error) { feedback.error(String(error)); }
    finally { setResolving(false); }
  };

  const orderedServers = [...servers].sort(compareMcpServers);
  const diffCount = syncPreview?.entries.length ?? 0;

  if (diffOpen) {
    return (
      <McpDiffPage
        preview={syncPreview}
        previewError={previewError}
        resolving={resolving}
        onBack={() => setDiffOpen(false)}
        onResolve={(entry, verb) => void resolveEntry(entry, verb)}
        onResolveAll={(verb) => void resolveAll(verb)}
        onRebuild={() => void rebuildFromDatabase()}
      />
    );
  }
  if (editingServer || creatingServer) {
    return (
      <McpEdit
        server={editingServer}
        create={creatingServer}
        onBack={(savedServer) => {
          setEditingServer(null);
          setCreatingServer(false);
          void (async () => {
            const next = await refresh(true, savedServer?.name);
            if (savedServer) {
              const saved = next?.find((server) => server.name === savedServer.name);
              if (saved) await probeTools(saved, false, false);
            }
          })();
        }}
        onDelete={editingServer ? () => removeServer(editingServer) : undefined}
      />
    );
  }
  return (
    <section className="apple-scroll-page mx-auto w-full max-w-none">
      <header className="apple-page-bar flex-wrap justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-accent">
            <McpIcon className="h-[22px] w-[22px]" />
          </span>
          <div className="flex items-center gap-2">
            <div className="apple-title">{t("list.title")}</div>
            {loaded ? <span className="apple-chip">{t("list.serverCount", { count: servers.length })}</span> : null}
          </div>
        </div>
        <div className="flex w-full max-w-md items-center justify-end gap-2">
          {diffCount || previewError ? (
            <button type="button" className="apple-action-button relative" aria-label={diffCount ? t("list.updateDiffAria", { count: diffCount }) : t("list.resolveDiff")} title={diffCount ? t("list.updateDiffAria", { count: diffCount }) : undefined} onClick={() => setDiffOpen(true)}>
              <GitCompare className="h-4 w-4" strokeWidth={2} />
              {t("list.resolveDiff")}
              <span className="apple-count-badge" aria-hidden="true">{diffCount ? (diffCount > 9 ? "9+" : diffCount) : "!"}</span>
            </button>
          ) : null}
          <button type="button" className="apple-action-button app-button--primary" onClick={() => setCreatingServer(true)}>
            <Plus className="h-4 w-4" strokeWidth={2} />
            {t("list.addServer")}
          </button>
        </div>
      </header>
      <div className="apple-edit-content">
        {loadError ? (
          <p className="muted mt-4 text-sm">
            {loadError}
            {loaded ? t("list.loadErrorHint") : ""}
          </p>
        ) : null}
        <div>
          {!servers.length ? (
            <EmptyStateCard loading={!loaded} icon={<McpIcon className="h-5 w-5" />}>
              <p className="muted">{t("empty.description")}</p>
            </EmptyStateCard>
          ) : servers.length ? (
            <div className="space-y-2">
              {orderedServers.map((server) => (
                <McpServerRow
                  key={server.name}
                  server={server}
                  result={probeResults[server.name]}
                  probing={Boolean(probingNames[server.name])}
                  detailsVisible={Boolean(toolsOpen[server.name])}
                  toolsBusy={Boolean(toolsLoading[server.name])}
                  toolsLoaded={Boolean(toolsLoaded[server.name])}
                  onEdit={setEditingServer}
                  onProbe={(target) => void probeServer(target)}
                  onToggleTools={(target) => void toggleTools(target)}
                  onToggleEnabled={(target, enabled) => void toggleEnabled(target, enabled)}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
