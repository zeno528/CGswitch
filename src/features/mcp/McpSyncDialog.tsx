import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AppDialog } from "../../components/AppDialog";
import { AppDisclosure } from "../../components/AppDisclosure";
import type { McpSyncDiffEntry, McpSyncPreview } from "../../types";

type SyncDirection = "live-to-db" | "db-to-live";
interface McpSyncDialogProps {
  open: boolean;
  preview: McpSyncPreview | null;
  previewError: string;
  busy: boolean;
  onClose: () => void;
  onApply: (direction: SyncDirection) => void;
}

const valueText = (value: unknown, t: TFunction<"mcp">) => value === null ? t("sync.notSet") : typeof value === "string" ? value : JSON.stringify(value);
const kindText = (entry: McpSyncDiffEntry, t: TFunction<"mcp">) => entry.kind === "live_only" ? t("sync.kind.liveOnly") : entry.kind === "db_only" ? t("sync.kind.dbOnly") : t("sync.kind.changed");
const detailFallback = (entry: McpSyncDiffEntry, t: TFunction<"mcp">) => entry.kind === "live_only" ? t("sync.detail.liveOnly") : entry.kind === "db_only" ? t("sync.detail.dbOnly") : t("sync.detail.changed");

export default function McpSyncDialog({ open, preview, previewError, busy, onClose, onApply }: McpSyncDialogProps) {
  const { t } = useTranslation("mcp");
  const [step, setStep] = useState<"diff" | "confirm">("diff");
  const [direction, setDirection] = useState<SyncDirection | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fieldLabels: Record<string, string> = { enabled: t("sync.field.enabled"), startup_timeout_sec: t("sync.field.startupTimeoutSec"), tool_timeout_sec: t("sync.field.toolTimeoutSec"), command: t("sync.field.command"), args: t("sync.field.args"), env: t("sync.field.env"), url: t("sync.field.url"), bearer_token_env_var: t("sync.field.bearerTokenEnvVar"), http_headers: t("sync.field.httpHeaders"), env_http_headers: t("sync.field.envHttpHeaders") };
  useEffect(() => { if (!open) { setStep("diff"); setDirection(null); setExpanded(new Set()); } }, [open]);
  const entries = preview?.entries ?? [];
  const pendingLines = useMemo(() => {
    const names = (kind: McpSyncDiffEntry["kind"]) => entries.filter((entry) => entry.kind === kind).map((entry) => entry.name);
    const parts = (values: string[]) => values.flatMap((value, index) => [index ? t("sync.listSeparator") : "", <code key={value} className="mono code-tok">{value}</code>]);
    if (!direction) return [];
    if (!preview) return [<span key="rebuild">{t("sync.rebuildUnparsable")}</span>, <span key="backup"><Trans ns="mcp" i18nKey="sync.autoBackup" components={{ code: <code className="mono code-tok" /> }} /></span>];
    const added = names("live_only"); const missing = names("db_only"); const changed = names("changed");
    const lines: React.ReactNode[] = [];
    if (direction === "db-to-live") {
      if (added.length) lines.push(<span key="added" className="font-semibold text-red-600 dark:text-red-400">{t("sync.confirm.removeAdded")}{parts(added)}</span>);
      if (missing.length) lines.push(<span key="missing">{t("sync.confirm.writeMissing")}{parts(missing)}</span>);
      if (changed.length) lines.push(<span key="changed">{t("sync.confirm.restoreChanged")}{parts(changed)}</span>);
      lines.push(<span key="backup"><Trans ns="mcp" i18nKey="sync.autoBackup" components={{ code: <code className="mono code-tok" /> }} /></span>);
    } else {
      if (added.length) lines.push(<span key="added">{t("sync.confirm.dbAdded")}{parts(added)}</span>);
      if (changed.length) lines.push(<span key="changed">{t("sync.confirm.dbChanged")}{parts(changed)}</span>);
      if (missing.length) lines.push(<span key="missing">{t("sync.confirm.dbDeleted")}{parts(missing)}</span>);
    }
    return lines;
  }, [direction, entries, preview, t]);

  const requestDirection = (next: SyncDirection) => { setDirection(next); setStep("confirm"); };
  const dialogDescription = step === "diff" && previewError
    ? t("sync.unparsableDescription")
    : undefined;
  const directionChoice = (next: SyncDirection) => {
    const dbToLive = next === "db-to-live";
    return (
      <button
        type="button"
        className="mcp-sync-choice apple-group flex w-full items-start justify-between gap-3 border-0 p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
        disabled={busy}
        onClick={() => requestDirection(next)}
        aria-label={dbToLive ? t("sync.choice.dbToLive") : t("sync.choice.liveToDb")}
      >
        <span className="min-w-0">
          <span className="block font-semibold">{dbToLive ? t("sync.choice.dbToLive") : t("sync.choice.liveToDb")}</span>
          <span className="muted mt-1 block text-xs leading-relaxed">
            {dbToLive ? previewError ? t("sync.choice.dbToLiveUnparsable") : t("sync.choice.dbToLiveHint") : t("sync.choice.liveToDbHint")}
          </span>
        </span>
      </button>
    );
  };

  return (
    <AppDialog
      open={open}
      onOpenChange={(next) => { if (!next && !busy) onClose(); }}
      title={step === "confirm" && direction ? direction === "db-to-live" ? t("sync.title.confirmDbToLive") : t("sync.title.confirmLiveToDb") : previewError ? t("sync.title.restore") : t("sync.title.diff")}
      description={dialogDescription}
      className="max-w-[560px]"
      footer={step === "confirm" ? (
        <div className="flex w-full items-center justify-end gap-2">
          <button type="button" className="apple-action-button" disabled={busy} onClick={() => setStep("diff")}>{previewError ? t("sync.back") : t("sync.backToDiff")}</button>
          <button type="button" className="apple-action-button app-button--primary" disabled={busy || !direction} onClick={() => direction && onApply(direction)}>{direction === "db-to-live" ? t("sync.title.confirmDbToLive") : t("sync.title.confirmLiveToDb")}</button>
        </div>
      ) : (
        <button type="button" className="apple-action-button" disabled={busy} onClick={onClose}>{t("sync.cancel")}</button>
      )}
    >
      {step === "confirm" ? (
        <div className="mcp-sync-confirm">
          <p className="mcp-sync-confirm__scope">
            <span className="field-subtitle">{t("sync.confirm.scope")}</span>
            <span>{direction === "db-to-live" ? previewError ? <>{t("sync.confirm.scopeUnparsable")}</> : <Trans ns="mcp" i18nKey="sync.confirm.scopeDbToLive" components={{ code: <code className="mono code-tok" /> }} /> : <>{t("sync.confirm.scopeLiveToDb")}</>}</span>
          </p>
          <div className="mcp-sync-confirm__changes">
            <div className="field-subtitle">{t("sync.confirm.summary")}</div>
            <ul className="mcp-sync-confirm__list">{pendingLines.map((line, index) => <li key={index}>{line}</li>)}</ul>
          </div>
        </div>
      ) : previewError ? (
        <div className="space-y-3">
          <p className="muted text-sm">{previewError}</p>
          {directionChoice("db-to-live")}
        </div>
      ) : preview ? (
        <div className="space-y-4">
          <div className="muted rounded-[var(--radius-control-sm)] bg-[color-mix(in_srgb,var(--sidebar-bg)_34%,var(--panel-bg))] px-3 py-2 text-sm">
            {t("sync.stats", { db: preview.db_count, live: preview.live_count, diff: preview.entries.length })}
          </div>
          <div className="space-y-2">
            <div className="field-subtitle">{t("sync.details")}</div>
            <div className="-m-1 max-h-[50vh] space-y-2 overflow-y-auto p-1">
              {entries.map((entry) => {
                const isExpanded = expanded.has(entry.name);
                return (
                  <AppDisclosure
                    key={entry.name}
                    className="mcp-sync-diff"
                    open={isExpanded}
                    onOpenChange={(next) => setExpanded((current) => {
                      const updated = new Set(current);
                      if (next) updated.add(entry.name); else updated.delete(entry.name);
                      return updated;
                    })}
                    summary={(
                      <>
                        <span className={`apple-chip ${entry.kind === "live_only" ? "chip-warn" : "chip-danger"}`}>{kindText(entry, t)}</span>
                        <span className="min-w-0 flex-1 truncate font-semibold">{entry.name}</span>
                      </>
                    )}
                  >
                    <div className="mcp-sync-diff__detail">
                      {entry.changed_fields.length ? (
                        <div className="grid gap-2.5">
                          {entry.changed_fields.map((diff) => (
                            <div key={diff.field} className="grid gap-1">
                              <div className="field-label">{fieldLabels[diff.field] ?? diff.field}</div>
                              <div className="mcp-sync-diff__values meta-xs">
                                <span>{t("sync.dbValue")}<code className="mono">{valueText(diff.db, t)}</code></span>
                                <span>{t("sync.liveValue")}<code className="mono">{valueText(diff.live, t)}</code></span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : entry.live_toml?.trim() || entry.db_toml?.trim() ? (
                        <pre className="mono muted m-0 whitespace-pre-wrap break-all meta-xs">{entry.live_toml ?? entry.db_toml}</pre>
                      ) : (
                        <p className="muted m-0 text-sm">{detailFallback(entry, t)}</p>
                      )}
                    </div>
                  </AppDisclosure>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <div className="field-subtitle">{t("sync.chooseConfig")}</div>
            <div className="grid gap-2">
              {directionChoice("live-to-db")}
              {directionChoice("db-to-live")}
            </div>
          </div>
        </div>
      ) : null}
    </AppDialog>
  );
}
