import { Check, Copy, Gauge, Globe, GripVertical, Power, Wifi } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { balanceChipClass, balanceQueryProviders, usageQueryProviders } from "../../presets";
import type { ProfileBalanceInfo, CodexProfileSummary } from "../../types";
import { PlanBadge } from "../../components/PlanBadge";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { ProfileIconTile } from "../../components/ProfileIconTile";
import { TrashIcon } from "../../components/TrashIcon";
import { localizeBalanceLabel } from "./balanceLabel";

interface ProfileCardContentProps {
  profile: Pick<CodexProfileSummary, "name" | "icon" | "kind" | "provider" | "model" | "reasoning_effort" | "plan_type" | "admin_url" | "show_balance">;
  balanceInfos: ProfileBalanceInfo[];
  balanceError: string;
  balanceRefreshing: boolean;
  hideModel?: boolean;
  onRefreshBalance?: (manual?: boolean) => void;
  onOpenAdmin?: () => void;
  onRename?: () => void;
}

export function ProfileCardContent({
  profile,
  balanceInfos,
  balanceError,
  balanceRefreshing,
  hideModel = false,
  onRefreshBalance,
  onOpenAdmin,
  onRename,
}: ProfileCardContentProps) {
  const { t } = useTranslation("profiles");
  const balanceInfo = balanceInfos[0] ?? null;
  const isSubscriptionProfile = profile.kind === "official";
  const supportsBalance = isSubscriptionProfile || balanceQueryProviders.has(profile.provider ?? "");
  const isUsageProvider = usageQueryProviders.has(profile.provider ?? "");
  // 后端回传的窗口标签按当前语言换词；后端没给时才用本语言兜底（映射见 balanceLabel.ts）
  const primaryLabel = localizeBalanceLabel(balanceInfo?.usage_label, t) ?? (isUsageProvider ? t("balance.window5h") : t("card.quota"));
  const weeklyLabel = localizeBalanceLabel(balanceInfo?.weekly_label, t) ?? (isUsageProvider ? t("balance.window7d") : t("balance.period"));
  const balanceLabel = isSubscriptionProfile ? t("card.quota") : isUsageProvider ? t("card.usage") : t("card.balance");
  const primaryUsagePercent = balanceInfo?.usage_percent != null ? (isSubscriptionProfile ? 100 - balanceInfo.usage_percent : balanceInfo.usage_percent) : null;
  const weeklyUsagePercent = balanceInfo?.weekly_usage_percent != null ? (isSubscriptionProfile ? 100 - balanceInfo.weekly_usage_percent : balanceInfo.weekly_usage_percent) : null;
  const primaryUsageText = isSubscriptionProfile ? t("card.usageRemaining", { label: primaryLabel }) : isUsageProvider ? `${primaryLabel}:` : `${primaryLabel} `;
  const weeklyUsageText = isSubscriptionProfile ? t("card.usageRemaining", { label: weeklyLabel }) : isUsageProvider ? `${weeklyLabel}:` : `${weeklyLabel} `;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <ProfileIconTile name={profile.name} icon={profile.icon} overlay={
        profile.admin_url ? (
          <button
            type="button"
            className="absolute inset-0 grid cursor-pointer place-items-center rounded-xl bg-(--panel-bg) text-accent opacity-0 outline-none transition-opacity duration-150 group-hover/tile:opacity-100 focus-visible:opacity-100"
            title={t("card.openWebsite")}
            aria-label={t("card.openWebsite")}
            onClick={(event) => { event.stopPropagation(); onOpenAdmin?.(); }}
          ><Globe className="h-4.5 w-4.5" strokeWidth={2} aria-hidden="true" /></button>
        ) : null
      } />
      <div className="profile-card-content__text min-w-0 flex-1">
        <div className="flex min-h-7 items-center gap-2">
          <h3 className="title-md cursor-pointer truncate leading-normal transition-colors hover:text-accent" title={t("card.clickToRename")} onClick={(event) => { event.stopPropagation(); onRename?.(); }}>{profile.name}</h3>
          {isSubscriptionProfile ? <PlanBadge plan={profile.plan_type} /> : null}
        </div>
        {!hideModel || (supportsBalance && profile.show_balance) ? <div className="profile-card-meta muted mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          {!hideModel ? <><span className="min-w-0 truncate">{profile.model ?? t("card.notSet")}</span>{profile.reasoning_effort ? <><span aria-hidden="true">·</span><span>{profile.reasoning_effort}</span></> : null}</> : null}
          {supportsBalance && profile.show_balance ? <button type="button" className="apple-chip" title={balanceError ? t("balance.queryFailedRetry") : t("balance.clickToRefresh")} aria-label={isSubscriptionProfile ? t("balance.chatgptQuota") : balanceLabel} aria-busy={balanceRefreshing} onClick={(event) => { event.stopPropagation(); onRefreshBalance?.(true); }}>
            {balanceRefreshing ? <LoadingSpinner size="sm" /> : <Gauge className={`h-3 w-3${balanceError ? " chip-danger" : ""}`} strokeWidth={2} aria-hidden="true" />}
            {balanceError ? <span>{t("balance.queryFailed")}</span> : primaryUsagePercent != null ? <><span>{primaryUsageText}</span><span className={balanceChipClass(balanceInfo?.usage_percent ?? null)}>{primaryUsagePercent}%</span>{balanceInfo?.usage_reset ? <span> {balanceInfo.usage_reset}</span> : null}{weeklyUsagePercent != null ? <><span> · {weeklyUsageText}</span><span className={balanceChipClass(balanceInfo?.weekly_usage_percent ?? null)}>{weeklyUsagePercent}%</span>{balanceInfo?.weekly_reset ? <span> {balanceInfo.weekly_reset}</span> : null}</> : null}</> : balanceInfo && !isUsageProvider ? <><span>{t("balance.balancePrefix")}</span>{balanceInfos.map((info, index) => <span key={info.currency || index} className="inline-flex items-center gap-1">{index > 0 ? <span aria-hidden="true">/</span> : null}<span className={balanceChipClass(null, info.total_balance)}>{info.total_balance.startsWith("-") ? "-" : ""}{info.currency === "USD" ? "$" : "¥"}{info.total_balance.replace(/^-/, "")}</span><span> {info.currency}</span></span>)}</> : <span>{`${balanceLabel} --`}</span>}
          </button> : null}
        </div> : null}
      </div>
    </div>
  );
}

/** 卡片测试连通按钮的通用门控与悬停文案：缺什么报什么，其余一律 ready 文案。
 *  Codex 卡片、拖拽预览与 Claude 卡片共用同一判定，避免按钮行各写一套。 */
export function connectionGate(hasBaseUrl: boolean, hasKey: boolean, titles: { ready: string; missingEndpoint: string; missingKey: string }) {
  const disabled = !hasBaseUrl || !hasKey;
  return {
    disabled,
    title: !disabled ? titles.ready : !hasBaseUrl ? titles.missingEndpoint : titles.missingKey,
  };
}

interface ProfileCardActionsProps {
  active: boolean;
  busy: boolean;
  testing: boolean;
  dragging?: boolean;
  model?: string | null;
  reasoningEffort?: string | null;
  /** 测试连通按钮是否禁用（调用方按各自领域判定：缺地址/缺密钥）。 */
  connectionDisabled: boolean;
  connectionTitle: string;
  onApply?: () => void;
  onDuplicate?: () => void;
  onTest?: () => void;
  onRemove?: () => void;
}

export function ProfileCardActions({ active, busy, testing, dragging = false, model, reasoningEffort, connectionDisabled, connectionTitle, onApply, onDuplicate, onTest, onRemove }: ProfileCardActionsProps) {
  const { t } = useTranslation("profiles");
  return (
    <div className={`profile-card-actions${dragging ? " profile-card-actions--dragging" : ""} flex shrink-0 items-center gap-2`} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.preventDefault()}>
      {model !== undefined || reasoningEffort ? (
        <span className="profile-card-action-meta">
          <span className="profile-card-action-meta__model">{model ?? t("card.notSet")}</span>
          {reasoningEffort ? <><span aria-hidden="true">·</span><span>{reasoningEffort}</span></> : null}
        </span>
      ) : null}
      <div className={dragging ? "profile-card-action-buttons flex shrink-0 items-center gap-2" : "profile-card-action-buttons pointer-events-none flex shrink-0 items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"}>
        <button type="button" className={`apple-icon-button ${active ? "app-button--primary" : "border border-(--panel-border) bg-(--secondary-button-bg) text-(--text-primary) enabled:hover:text-accent disabled:opacity-50"}`} disabled={busy || active} aria-pressed={active} aria-label={active ? t("actions.inUse") : t("actions.switch")} title={active ? t("actions.inUse") : t("actions.switch")} onClick={onApply}>
          {active ? <Check size={16} strokeWidth={2} aria-hidden="true" /> : <Power size={16} strokeWidth={2} aria-hidden="true" />}
        </button>
        <button type="button" className="apple-icon-button text-[var(--text-secondary)] hover:text-accent" title={t("actions.duplicate")} aria-label={t("actions.duplicate")} onClick={onDuplicate}><Copy className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" /></button>
        <button type="button" className="apple-icon-button text-[var(--text-secondary)] enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40" disabled={connectionDisabled || busy || testing} title={connectionTitle} aria-label={t("connection.test")} onClick={onTest}>{testing ? <LoadingSpinner size="md" /> : <Wifi className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />}</button>
        <button type="button" className="profile-card-delete apple-icon-button text-[var(--danger)]/60 enabled:hover:bg-(--danger)/10 enabled:hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || active} title={t("actions.delete")} aria-label={t("actions.delete")} onClick={onRemove}><TrashIcon /></button>
      </div>
    </div>
  );
}

/** 拖拽浮层共享外壳：源卡片几何 + 拖拽把手，内容行与操作行由调用方经 children 给。 */
export function ProfileDragPreviewShell({ width, height, active, children }: { width: number | null; height: number | null; active: boolean; children: ReactNode }) {
  const stateClass = active ? "is-active brand-gradient-surface is-drag-hover" : "is-drag-hover";
  return (
    <div className={`drag-dragging apple-group profile-drag-preview group flex cursor-pointer select-none flex-col gap-4 px-5 py-4.5 sm:flex-row sm:items-center sm:justify-between ${stateClass}`} style={{ width: width ? `${width}px` : undefined, height: height ? `${height}px` : undefined }}>
      <span className="drag-handle -ml-5 -mr-4 grid shrink-0 cursor-grabbing place-items-center self-center rounded-md py-1 pl-3 pr-3 muted sm:self-stretch" aria-hidden="true">
        <GripVertical className="h-4 w-4" strokeWidth={2} />
      </span>
      {children}
    </div>
  );
}
