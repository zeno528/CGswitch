import { Check, Copy, Gauge, Globe, GripVertical, KeyRound, Monitor, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../../api";
import { balanceChipClass, balanceQueryProviders, usageQueryProviders } from "../../presets";
import type { ProfileBalanceInfo, ProfileSummary } from "../../types";
import { useFeedback } from "../../app/Feedback";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { ProfileIconTile } from "../../components/ProfileIconTile";
import { TrashIcon } from "../../components/TrashIcon";
import { localizeBalanceLabel } from "./balanceLabel";

const balanceInfoCache = new Map<string, ProfileBalanceInfo>();
const balanceErrorCache = new Map<string, string>();

export function getCachedProfileBalance(profileId: string, fallback: ProfileBalanceInfo | null = null) {
  if (balanceErrorCache.has(profileId)) return null;
  return balanceInfoCache.get(profileId) ?? fallback;
}

export function getCachedProfileBalanceError(profileId: string) {
  return balanceErrorCache.get(profileId) ?? "";
}

interface ProfileCardProps {
  profile: ProfileSummary;
  active: boolean;
  dragHover?: boolean;
  busy: boolean;
  activationEpoch: number;
  subscriptionAuthed: boolean;
  balanceCache?: Record<string, ProfileBalanceInfo>;
  onApply: () => void;
  onRename: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

interface ProfileCardContentProps {
  profile: ProfileSummary;
  subscriptionAuthed: boolean;
  balanceInfos: ProfileBalanceInfo[];
  balanceError: string;
  onRefreshBalance?: () => void;
  onOpenAdmin?: () => void;
  onRename?: () => void;
}

export function ProfileCardContent({
  profile,
  subscriptionAuthed,
  balanceInfos,
  balanceError,
  onRefreshBalance,
  onOpenAdmin,
  onRename,
}: ProfileCardContentProps) {
  const { t } = useTranslation("profiles");
  const balanceInfo = balanceInfos[0] ?? null;
  const isSubscriptionProfile = profile.kind === "official";
  const supportsBalance = isSubscriptionProfile || balanceQueryProviders.has(profile.provider ?? "");
  const isUsageProvider = usageQueryProviders.has(profile.provider ?? "");
  const authSource = profile.auth_source ?? (profile.account_id ? "oauth" : "desktop");
  const authTitle = `${authSource === "desktop" ? t("card.authDesktop") : t("card.authOAuth")}${subscriptionAuthed ? "" : t("card.authNotSignedIn")}`;
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
      <ProfileIconTile name={profile.name} icon={profile.icon} />
      <div className="profile-card-content__text min-w-0 flex-1">
        <div className="flex min-h-7 items-center gap-2">
          <h3 className="title-md cursor-pointer truncate leading-normal transition-colors hover:text-accent" title={t("card.clickToRename")} onClick={(event) => { event.stopPropagation(); onRename?.(); }}>{profile.name}</h3>
          {profile.admin_url ? <button type="button" className="apple-icon-button !h-6 !w-7 shrink-0 text-accent" title={t("card.openWebsite")} aria-label={t("card.openWebsite")} onClick={(event) => { event.stopPropagation(); onOpenAdmin?.(); }}><Globe className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /></button> : null}
          {!profile.provider ? <span className={`profile-card-auth-badge inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${subscriptionAuthed ? "bg-accent/10 text-accent" : "bg-black/5 muted dark:bg-white/6"}`} title={authTitle} aria-label={authTitle}>
            {authSource === "desktop" ? <Monitor className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" /> : <KeyRound className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />}
          </span> : null}
        </div>
        <div className="profile-card-meta muted mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          <span className="min-w-0 truncate">{profile.model ?? t("card.notSet")}</span>
          {profile.reasoning_effort ? <><span aria-hidden="true">·</span><span>{profile.reasoning_effort}</span></> : null}
          {supportsBalance && profile.show_balance ? <button type="button" className="apple-chip" title={balanceError ? t("balance.queryFailedRetry") : isSubscriptionProfile ? t("balance.subscriptionTooltip") : t("balance.clickToRefresh")} aria-label={isSubscriptionProfile ? t("balance.chatgptQuota") : balanceLabel} onClick={(event) => { event.stopPropagation(); onRefreshBalance?.(); }}>
            <Gauge className={`h-3 w-3${balanceError ? " chip-danger" : ""}`} strokeWidth={2} aria-hidden="true" />
            {balanceError ? <span>{t("balance.queryFailed")}</span> : primaryUsagePercent != null ? <><span>{primaryUsageText}</span><span className={balanceChipClass(balanceInfo?.usage_percent ?? null, false)}>{primaryUsagePercent}%</span>{balanceInfo?.usage_reset ? <span> {balanceInfo.usage_reset}</span> : null}{weeklyUsagePercent != null ? <><span> · {weeklyUsageText}</span><span className={balanceChipClass(balanceInfo?.weekly_usage_percent ?? null, false)}>{weeklyUsagePercent}%</span>{balanceInfo?.weekly_reset ? <span> {balanceInfo.weekly_reset}</span> : null}</> : null}</> : balanceInfo && !isUsageProvider ? <><span>{t("balance.balancePrefix")}</span>{balanceInfos.map((info, index) => <span key={info.currency || index} className="inline-flex items-center gap-1">{index > 0 ? <span aria-hidden="true">/</span> : null}<span className={balanceChipClass(null, false, info.total_balance)}>{info.total_balance.startsWith("-") ? "-" : ""}{info.currency === "USD" ? "$" : "¥"}{info.total_balance.replace(/^-/, "")}</span><span> {info.currency}</span></span>)}</> : <span>{`${balanceLabel} --`}</span>}
          </button> : null}
        </div>
      </div>
    </div>
  );
}

interface ProfileCardActionsProps {
  active: boolean;
  busy: boolean;
  connectionDimmed: boolean;
  connectionTitle: string;
  testing: boolean;
  dragging?: boolean;
  onApply?: () => void;
  onDuplicate?: () => void;
  onTest?: () => void;
  onRemove?: () => void;
}

export function ProfileCardActions({ active, busy, connectionDimmed, connectionTitle, testing, dragging = false, onApply, onDuplicate, onTest, onRemove }: ProfileCardActionsProps) {
  const { t } = useTranslation("profiles");
  return (
    <div className={dragging ? "profile-card-actions profile-card-actions--dragging flex shrink-0 items-center gap-2" : "profile-card-actions pointer-events-none flex shrink-0 items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.preventDefault()}>
      <button type="button" className="apple-action-button app-button--primary" disabled={busy || active} onClick={onApply}>{active ? <><Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />{t("actions.inUse")}</> : t("actions.switch")}</button>
      <button type="button" className="apple-icon-button text-[var(--text-secondary)] hover:bg-(--profile-chip-bg) hover:text-accent" title={t("actions.duplicate")} aria-label={t("actions.duplicate")} onClick={onDuplicate}><Copy className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" /></button>
      <button type="button" className={`apple-icon-button enabled:hover:bg-(--profile-chip-bg) disabled:cursor-not-allowed disabled:opacity-40 ${connectionDimmed ? "text-[var(--text-secondary)]" : "text-accent"}`} disabled={connectionDimmed || busy || testing} title={connectionTitle} aria-label={t("connection.test")} onClick={onTest}>{testing ? <LoadingSpinner size="md" /> : <Wifi className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />}</button>
      <button type="button" className="profile-card-delete apple-icon-button text-[var(--danger)]/60 enabled:hover:bg-(--danger)/10 enabled:hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || active} title={t("actions.delete")} aria-label={t("actions.delete")} onClick={onRemove}><TrashIcon /></button>
    </div>
  );
}

export default function ProfileCard({
  profile,
  active,
  dragHover = false,
  busy,
  activationEpoch,
  subscriptionAuthed,
  balanceCache,
  onApply,
  onRename,
  onEdit,
  onRemove,
  onDuplicate,
}: ProfileCardProps) {
  const feedback = useFeedback();
  const { t } = useTranslation("profiles");
  const [testing, setTesting] = useState(false);
  const [connectionState, setConnectionState] = useState<"unknown" | "ok" | "fail">("unknown");
  const [balanceInfos, setBalanceInfos] = useState<ProfileBalanceInfo[]>([]);
  const [balanceError, setBalanceError] = useState("");
  const balanceFetchingRef = useRef(false);
  const supportsBalance = profile.kind === "official" || balanceQueryProviders.has(profile.provider ?? "");
  const sortable = useSortable({ id: profile.id });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };

  const invalidateBalance = (message: string) => {
    setBalanceInfos([]);
    balanceInfoCache.delete(profile.id);
    setBalanceError(message);
    balanceErrorCache.set(profile.id, message);
  };

  const fetchBalance = async () => {
    if (!supportsBalance || !profile.show_balance || balanceFetchingRef.current) return;
    if (profile.kind !== "official" && !profile.has_key) {
      invalidateBalance(t("balance.missingApiKey"));
      return;
    }
    balanceFetchingRef.current = true;
    try {
      const result = await api.getProfileBalance(profile.id);
      const infos = result.balance_infos;
      if (!infos[0]) throw new Error("查询未返回余额/用量数据"); // i18n-exempt: 该消息只被当布尔用，界面渲染的是固定文案 balance.queryFailed
      setBalanceError("");
      balanceErrorCache.delete(profile.id);
      setBalanceInfos(infos);
      balanceInfoCache.set(profile.id, infos[0]);
      void api.setProfileBalance(profile.id, infos[0]);
    } catch (error) {
      invalidateBalance(String(error));
    } finally {
      balanceFetchingRef.current = false;
    }
  };

  useEffect(() => {
    if (!supportsBalance) return;
    const cachedError = getCachedProfileBalanceError(profile.id);
    const cachedInfo = balanceInfoCache.get(profile.id) ?? balanceCache?.[profile.id] ?? null;
    setBalanceInfos(cachedError || !cachedInfo ? [] : [cachedInfo]);
    setBalanceError(cachedError);
    void fetchBalance();
    // The root owns the single activation listener; cards only react to its epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activationEpoch, profile.id, profile.show_balance, supportsBalance]);

  useEffect(() => {
    if (!active || !supportsBalance || !profile.show_balance) return;
    const timer = window.setInterval(() => void fetchBalance(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
    // The interval only exists for the active profile; activationEpoch handles focus refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, profile.id, profile.show_balance, supportsBalance]);

  useEffect(() => setConnectionState("unknown"), [profile.id]);

  const connectionDimmed = !profile.provider ? !subscriptionAuthed : connectionState === "fail" || !profile.has_key;
  const connectionTitle = !profile.provider
    ? subscriptionAuthed ? t("connection.testSubscription") : t("connection.subscriptionUnverified")
    : !profile.has_key ? t("connection.missingApiKeyWarning") : t("connection.test");
  const testConnection = async () => {
    if (testing) return;
    if (!profile.provider && !subscriptionAuthed) {
      feedback.warning(t("connection.subscriptionWarning"));
      return;
    }
    if (profile.provider && !profile.has_key) {
      setConnectionState("fail");
      feedback.warning(t("connection.missingApiKeyWarning"));
      return;
    }
    setTesting(true);
    try {
      const result = await api.testProfileConnection(profile.id);
      if (result.ok) {
        setConnectionState("ok");
        feedback.success(t("connection.ok", { latency: result.latency_ms != null ? ` · ${result.latency_ms}ms` : "" }));
      } else {
        setConnectionState("fail");
        feedback.error(t("connection.failed", { error: result.error ?? t("connection.unknownError") }));
      }
    } catch (error) {
      setConnectionState("fail");
      feedback.error(t("connection.testFailed", { error: String(error) }));
    } finally {
      setTesting(false);
    }
  };

  return (
    <article
      ref={sortable.setNodeRef}
      data-draggable
      data-profile-id={profile.id}
      style={style}
      className={`apple-group${active ? " is-active brand-gradient-surface" : ""}${dragHover ? " is-drag-hover" : ""} group flex cursor-pointer select-none flex-col gap-4 px-5 py-4.5 sm:flex-row sm:items-center sm:justify-between ${sortable.isDragging ? "pointer-events-none opacity-0" : "opacity-100"}`}
      title={t("card.clickToEdit")}
      onClick={onEdit}
    >
      <span className="drag-handle -ml-5 -mr-4 grid shrink-0 cursor-grab place-items-center self-center rounded-md py-1 pl-3 pr-3 muted transition-colors hover:opacity-70 active:cursor-grabbing sm:self-stretch" title={t("card.dragToReorder")} aria-label={t("card.dragToReorder")} {...sortable.attributes} {...sortable.listeners} onClick={(event) => event.stopPropagation()}>
        <GripVertical className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </span>
      <ProfileCardContent
        profile={profile}
        subscriptionAuthed={subscriptionAuthed}
        balanceInfos={balanceInfos}
        balanceError={balanceError}
        onRefreshBalance={fetchBalance}
        onOpenAdmin={() => void api.openUrl(profile.admin_url!).catch((error) => feedback.error(String(error)))}
        onRename={onRename}
      />
      <ProfileCardActions active={active} busy={busy} connectionDimmed={connectionDimmed} connectionTitle={connectionTitle} testing={testing} onApply={onApply} onDuplicate={onDuplicate} onTest={() => void testConnection()} onRemove={onRemove} />
    </article>
  );
}
