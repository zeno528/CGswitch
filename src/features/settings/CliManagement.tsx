import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { ArrowUp, FolderOpen, Globe, Zap } from "lucide-react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
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
  const [status, setStatus] = useState<CliStatus | null>(null);
  const [update, setUpdate] = useState<CliUpdate | null>(null);
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<CliOperation>(null);
  const [error, setError] = useState<CliFailure | null>(null);
  const running = useRef(false);
  const commands = clients[client];

  const refresh = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setOperation("refresh");
    setError(null);
    setUpdate(null);
    try { setStatus(await commands.status()); }
    catch (error) { setError(cliFailure(error, "detect")); }
    finally { running.current = false; setBusy(false); setOperation(null); }
  };

  useEffect(() => { if (active) void refresh(); }, [active]);

  const check = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setOperation("check");
    setError(null);
    setUpdate(null);
    try {
      const result = await commands.check();
      setStatus(result.status);
      setUpdate(result);
    } catch (error) { setError(cliFailure(error, "fetch_version")); }
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
      setStatus(result);
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
            {status?.version ? <span className="plan-badge mono">{status.version}</span> : null}
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
              <span className="cli-fact-path mono" title={status.path}>{status.path}</span>
              {status.other_paths.map((path) => <span key={path} className="cli-fact-path mono" title={path}>{path}</span>)}
            </span>
          ) : null}
          <span className="cli-fact">
            <Globe size={14} strokeWidth={2} aria-hidden="true" />
            <span className="meta-xs">{t("cli.networkLabel")}</span>
            <span className="cli-fact-value">
              {t(status.network === "proxy" ? "cli.proxy" : "cli.direct")}
            </span>
            {status.proxy ? <span className="cli-fact-path mono" title={status.proxy}>{status.proxy}</span> : null}
          </span>
        </div>
      ) : null}
      {error ? <div className="setting-description text-(--danger)" role="alert">{cliFailureMessage(error, client, t)}</div> : null}
    </div>
  );
}
