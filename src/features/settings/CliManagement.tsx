import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowUp, FolderOpen, Globe, Zap } from "lucide-react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { getCachedCliStatus, runCliUpdateCheck, runCliUpdateCheckQuietly, setCliStatusCache, setCachedCliUpdate, touchCliUpdateCheckedAt } from "../../app/managementDataCache";
import { useProxyStatus } from "../../app/useProxyStatus";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import type { CliFailure, CliStatus, CliUpdate } from "../../types";

const clients = {
  codex: { label: "Codex", icon: "/codex.svg", status: api.codexGetCliStatus, check: api.codexCheckCliUpdate, install: api.codexInstallCli, update: api.codexUpdateCli },
  claude: { label: "Claude Code", icon: "/claude-code.svg", status: api.claudeGetCliStatus, check: api.claudeCheckCliUpdate, install: api.claudeInstallCli, update: api.claudeUpdateCli },
};
type Client = keyof typeof clients;
type CliOperation = "refresh" | "check" | "install" | "update" | null;

function cliFailure(error: unknown, stage: string): CliFailure {
  if (error && typeof error === "object" && "stage" in error && typeof error.stage === "string"
    && "kind" in error && typeof error.kind === "string" && "message" in error && typeof error.message === "string") {
    return error as CliFailure;
  }
  return { stage, kind: "internal", message: String(error) };
}

export function cliFailureMessage(error: CliFailure, client: Client, t: TFunction<"settings">) {
  return t("cli.failed", {
    client: clients[client].label,
    stage: t(`cli.errorStages.${error.stage}`, { defaultValue: t("cli.errorStages.operation") }),
    reason: t(`cli.errors.${error.stage}_${error.kind}`, {
      defaultValue: t(`cli.errors.${error.kind}`, { defaultValue: t("cli.errors.internal") }),
    }),
  });
}

// 在 SettingsView 中调用；切分区只隐藏卡片，不丢失任务和错误。
export function useCliManagement(client: Client, active: boolean) {
  const { t } = useTranslation("settings");
  const { success } = useFeedback();
  // 缓存直出：进分区首帧就渲染上次检测结果，骨架闪帧由静默刷新消除（同备份列表的取缓存写法）。
  const [status, setStatus] = useState<CliStatus | null>(getCachedCliStatus(client));
  const [update, setUpdate] = useState<CliUpdate | null>(null);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<CliOperation>(null);
  const [error, setError] = useState<CliFailure | null>(null);
  const running = useRef(false);
  const detected = useRef(false);
  const commands = clients[client];

  // 缓存写穿：检测/安装/升级的每个落点都同步进缓存，下次进页直出最新状态。
  const applyStatus = (next: CliStatus) => { setCliStatusCache(client, next); setStatus(next); };

  const refresh = async (keepUpdate = false): Promise<CliStatus | null> => {
    if (running.current) return null;
    running.current = true;
    setBusy(true);
    setOperation("refresh");
    setError(null);
    if (!keepUpdate) setUpdate(null);
    try {
      const next = await commands.status();
      applyStatus(next);
      return next;
    }
    catch (error) { setError(cliFailure(error, "detect")); return null; }
    finally { running.current = false; setBusy(false); setOperation(null); }
  };

  // 进页静默检查一次更新（仅原生安装可升级）：走共享服务（结果进跨页缓存，
  // 全局计时器因此不会短期内重复检查）；失败不进界面——后端已留
  // [app.cli.check] Warn 日志，前端吞掉即可；有新版本才落 update 显示升级胶囊，
  // 无更新保持卡片干净。主动点击的 check 失败照常透出，两条链路互不影响。
  const silentCheck = async () => {
    if (running.current) return;
    running.current = true;
    const result = await runCliUpdateCheckQuietly(client);
    if (result) {
      applyStatus(result.status);
      setUpdate(result.available ? result : null);
    }
    running.current = false;
  };

  // 每次重新进入 Agent 工具分区都检测一次，纠正外部安装/升级造成的本地缓存过期；
  // 检测成功且为原生安装时顺带静默检查线上更新。
  // 离开分区时丢弃"当前没有更新"这类一次性反馈（常驻只会变成视觉噪音）；
  // 升级胶囊是可行动状态，保留到真正升级或版本变化。
  useEffect(() => {
    if (!active) {
      detected.current = false;
      if (update && !update.available) setUpdate(null);
      return;
    }
    if (detected.current && status) return;
    detected.current = true;
    void (async () => {
      const next = await refresh(true);
      if (next?.installation === "native") await silentCheck();
    })();
  }, [active, status]);

  const check = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setOperation("check");
    setError(null);
    setUpdate(null);
    try {
      const result = await runCliUpdateCheck(client);
      applyStatus(result.status);
      setUpdate(result);
    } catch (error) {
      touchCliUpdateCheckedAt(client); // 手动失败的检查也推进冷却，定时器不立刻重试
      setError(cliFailure(error, "fetch_version"));
    }
    finally { running.current = false; setBusy(false); setOperation(null); }
  };

  const run = async (install: boolean) => {
    if (running.current || (!install && !update?.available)) return;
    running.current = true;
    setBusy(true);
    setOperation(install ? "install" : "update");
    setError(null);
    setUpdate(null);
    try {
      const result = await (install ? commands.install() : commands.update());
      applyStatus(result);
      // 升级/安装成功的权威落点：本机版本已追平官方（后端 verify_update 校验过），
      // 更新缓存立即翻转，供应商页胶囊同步消失，不等下一次检查。
      setCachedCliUpdate(client, {
        available: false,
        latest_version: update?.latest_version ?? result.version ?? "",
        channel: update?.channel ?? "latest",
      });
      success(t(install ? "cli.installComplete" : "cli.updateComplete", {
        client: commands.label,
        version: result.version ?? "",
      }));
    } catch (error) { setError(cliFailure(error, "run_cli")); }
    finally { running.current = false; setBusy(false); setOperation(null); }
  };

  return { status, update, busy, operation, error, refresh, check, run };
}

export function CliCard({ client, management }: { client: Client; management: ReturnType<typeof useCliManagement> }) {
  const { t } = useTranslation("settings");
  const { status, update, busy, operation, error, check, run } = management;
  // 网络/代理读共享订阅（窗口激活即刷新）；检测快照里的 network/proxy 是拷贝，
  // 会话内会失真，仅在共享值尚未就绪时兜底。
  const proxyStatus = useProxyStatus();
  const networkStatus = proxyStatus ?? (status ? { proxy: status.proxy, error: false } : null);
  // 进行中反馈只显示当前用户动作，不暴露安装器内部阶段。
  const showProgress = busy && operation !== "refresh";
  const stageText = showProgress
    ? t(operation === "check" ? "cli.checkingUpdate" : operation === "update" ? "cli.updating" : operation === "install" ? "cli.installing" : "cli.working")
    : status?.busy ? t("cli.working") : null;
  return (
    <div className="apple-group flex flex-col gap-2.5 px-(--gap-card-inline) py-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center" aria-hidden="true">
          <img src={clients[client].icon} alt="" className="h-5 w-5" draggable={false} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="setting-title">{clients[client].label}</span>
            {status?.source ? (
              <span className="plan-badge">
                {t(`cli.sources.${client}.${status.source}`, { defaultValue: status.source })}
              </span>
            ) : null}
            {status?.installation === "missing" ? <span className="apple-chip">{t("cli.missing")}</span> : null}
            {status?.version ? <span className="plan-badge">{status.version}</span> : null}
            {status?.installation === "native" && update?.available ? (
              <button
                type="button"
                className="plan-badge cli-upgrade-pill"
                disabled={busy || status.busy}
                title={t("cli.updateAvailable", { version: update.latest_version, channel: update.channel })}
                onClick={() => void run(false)}
              >
                <ArrowUp size={11} strokeWidth={2} aria-hidden="true" />
                {t("cli.updateTo", { version: update.latest_version })}
              </button>
            ) : null}
            {showProgress || status?.busy ? (
              <span className="inline-flex items-center gap-1.5 text-(--text-secondary)" role="status" aria-live="polite">
                <LoadingSpinner size="md" />
                <span className="meta-xs">{stageText}</span>
              </span>
            ) : null}
            {!busy && update && !update.available ? (
              <span className="meta-xs" role="status" aria-live="polite">{t("cli.noUpdate", { version: update.latest_version, channel: update.channel })}</span>
            ) : null}
          </div>
          <div className="setting-description mt-0.5">{t("cli.description")}</div>
          {status && !["missing", "native"].includes(status.installation)
            ? <div className="setting-description mt-0.5">{t(status.installation === "broken" ? "cli.broken" : status.installation === "other" ? "cli.other" : "cli.conflict")}</div>
            : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button type="button" className={status?.installation === "native" ? "apple-action-button" : "apple-action-button app-button--primary"} disabled={busy || !status || status.busy || !["missing", "broken", "native"].includes(status.installation)} onClick={() => status?.installation === "native" ? void check() : void run(true)}>
            {t(status?.installation === "native" ? "cli.checkUpdate" : "cli.install")}
          </button>
        </div>
      </div>
      {status ? (
        <div className="cli-facts">
          {status.embedded_paths?.length ? (
            <span className="cli-fact">
              <Zap size={14} strokeWidth={2} aria-hidden="true" />
              <span>{t("cli.embedded")}</span>
            </span>
          ) : null}
          {status.path ? (
            <span className="cli-fact">
              <FolderOpen size={14} strokeWidth={2} aria-hidden="true" />
              <span className="meta-xs">{t("cli.pathLabel")}</span>
              <span className="cli-fact-path" title={status.path}>{status.path}</span>
              {status.other_paths.map((path) => <span key={path} className="cli-fact-path" title={path}>{path}</span>)}
            </span>
          ) : null}
          <span className="cli-fact">
            <Globe size={14} strokeWidth={2} aria-hidden="true" />
            <span className="meta-xs">{t("cli.networkLabel")}</span>
            <span className="cli-fact-value">
              {t(networkStatus?.proxy ? "cli.proxy" : "cli.direct")}
            </span>
            {networkStatus?.proxy ? <span className="cli-fact-path" title={networkStatus.proxy}>{networkStatus.proxy}</span> : null}
          </span>
        </div>
      ) : null}
      {error ? <div className="setting-description text-(--danger)" role="alert">{cliFailureMessage(error, client, t)}</div> : null}
    </div>
  );
}
