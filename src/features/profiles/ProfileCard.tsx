import { Check, Copy, Gauge, Globe, GripVertical, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../../api";
import { authQuotaErrorKind, getAuthQuotaError, getVisibleAuthQuota, profileAuthQuotaCacheKey, setAuthQuotaFailure, setAuthQuotaSuccess } from "../../app/authQuotaCache";
import { balanceChipClass, balanceQueryProviders, usageQueryProviders } from "../../presets";
import type { ProfileBalanceInfo, ProfileSummary } from "../../types";
import { useFeedback } from "../../app/Feedback";
import { PlanBadge } from "../../components/PlanBadge";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { ProfileIconTile } from "../../components/ProfileIconTile";
import { TrashIcon } from "../../components/TrashIcon";
import { localizeBalanceLabel } from "./balanceLabel";

const balanceInfoCache = new Map<string, ProfileBalanceInfo>();
const balanceErrorCache = new Map<string, string>();

export function getCachedProfileBalance(profileId: string, fallback: ProfileBalanceInfo | null = null, authQuotaKey?: string | null) {
  if (authQuotaKey) {
    return getVisibleAuthQuota(authQuotaKey, balanceInfoCache.get(profileId) ?? fallback);
  }
  if (balanceErrorCache.has(profileId)) return null;
  return balanceInfoCache.get(profileId) ?? fallback;
}

export function getCachedProfileBalanceError(profileId: string, authQuotaKey?: string | null) {
  if (authQuotaKey) return getAuthQuotaError(authQuotaKey);
  return balanceErrorCache.get(profileId) ?? "";
}

interface ProfileCardProps {
  profile: ProfileSummary;
  active: boolean;
  dragHover?: boolean;
  busy: boolean;
  activationEpoch: number;
  /// 本次进程启动还没走完（首屏尚未出窗）——只有这时才值得把余额刷新往后放
  coldStart: boolean;
  balanceCache?: Record<string, ProfileBalanceInfo>;
  onApply: () => void;
  onRename: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

interface ProfileCardContentProps {
  profile: ProfileSummary;
  balanceInfos: ProfileBalanceInfo[];
  balanceError: string;
  balanceRefreshing: boolean;
  onRefreshBalance?: (manual?: boolean) => void;
  onOpenAdmin?: () => void;
  onRename?: () => void;
}

export function ProfileCardContent({
  profile,
  balanceInfos,
  balanceError,
  balanceRefreshing,
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
      <ProfileIconTile name={profile.name} icon={profile.icon} />
      <div className="profile-card-content__text min-w-0 flex-1">
        <div className="flex min-h-7 items-center gap-2">
          <h3 className="title-md cursor-pointer truncate leading-normal transition-colors hover:text-accent" title={t("card.clickToRename")} onClick={(event) => { event.stopPropagation(); onRename?.(); }}>{profile.name}</h3>
          {isSubscriptionProfile ? <PlanBadge plan={profile.plan_type} /> : null}
          {profile.admin_url ? <button type="button" className="apple-icon-button !h-6 !w-7 shrink-0 text-accent" title={t("card.openWebsite")} aria-label={t("card.openWebsite")} onClick={(event) => { event.stopPropagation(); onOpenAdmin?.(); }}><Globe className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /></button> : null}
        </div>
        <div className="profile-card-meta muted mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          <span className="min-w-0 truncate">{profile.model ?? t("card.notSet")}</span>
          {profile.reasoning_effort ? <><span aria-hidden="true">·</span><span>{profile.reasoning_effort}</span></> : null}
          {supportsBalance && profile.show_balance ? <button type="button" className="apple-chip" title={balanceError ? t("balance.queryFailedRetry") : t("balance.clickToRefresh")} aria-label={isSubscriptionProfile ? t("balance.chatgptQuota") : balanceLabel} aria-busy={balanceRefreshing} onClick={(event) => { event.stopPropagation(); onRefreshBalance?.(true); }}>
            {balanceRefreshing ? <LoadingSpinner size="sm" /> : <Gauge className={`h-3 w-3${balanceError ? " chip-danger" : ""}`} strokeWidth={2} aria-hidden="true" />}
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
  profile: ProfileSummary;
  testing: boolean;
  dragging?: boolean;
  onApply?: () => void;
  onDuplicate?: () => void;
  onTest?: () => void;
  onRemove?: () => void;
}

export function ProfileCardActions({ active, busy, profile, testing, dragging = false, onApply, onDuplicate, onTest, onRemove }: ProfileCardActionsProps) {
  const { t } = useTranslation("profiles");
  const connectionDisabled = profile.provider ? !profile.has_base_url || !profile.has_key : false;
  // 订阅与普通供应商共用同一套悬停文案：缺什么报什么，其余一律“测试连通性”
  const connectionTitle = !profile.provider || (profile.has_base_url && profile.has_key)
    ? t("connection.test")
    : !profile.has_base_url ? t("connection.missingApiEndpointWarning")
      : t("connection.missingApiKeyWarning");
  return (
    <div className={dragging ? "profile-card-actions profile-card-actions--dragging flex shrink-0 items-center gap-2" : "profile-card-actions pointer-events-none flex shrink-0 items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100"} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.preventDefault()}>
      <button type="button" className="apple-action-button app-button--primary" disabled={busy || active} title={active ? t("actions.inUse") : t("actions.switch")} onClick={onApply}>{active ? <><Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />{t("actions.inUse")}</> : t("actions.switch")}</button>
      <button type="button" className="apple-icon-button text-[var(--text-secondary)] hover:bg-(--profile-chip-bg) hover:text-accent" title={t("actions.duplicate")} aria-label={t("actions.duplicate")} onClick={onDuplicate}><Copy className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" /></button>
      <button type="button" className="apple-icon-button text-[var(--text-secondary)] enabled:hover:bg-(--profile-chip-bg) enabled:hover:text-accent disabled:cursor-not-allowed disabled:opacity-40" disabled={connectionDisabled || busy || testing} title={connectionTitle} aria-label={t("connection.test")} onClick={onTest}>{testing ? <LoadingSpinner size="md" /> : <Wifi className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />}</button>
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
  coldStart,
  balanceCache,
  onApply,
  onRename,
  onEdit,
  onRemove,
  onDuplicate,
}: ProfileCardProps) {
  const feedback = useFeedback();
  const { t } = useTranslation("profiles");
  const authQuotaKey = profileAuthQuotaCacheKey(profile);
  // 恢复缓存显示的唯一入口：内存缓存（上次查询的最新值）优先，回退 DB 快照。
  // 初始化器与挂载 effect 必须同源，否则第一帧后会跳变（数字↔失败态）造成整卡闪动。
  const restoreCachedBalance = () => {
    const error = getCachedProfileBalanceError(profile.id, authQuotaKey);
    const info = getCachedProfileBalance(profile.id, balanceCache?.[profile.id] ?? null, authQuotaKey);
    return { error, info: error || !info ? null : info };
  };
  const initial = restoreCachedBalance();
  const [testing, setTesting] = useState(false);
  const [balanceInfos, setBalanceInfos] = useState<ProfileBalanceInfo[]>(() => (initial.info ? [initial.info] : []));
  const [balanceError, setBalanceError] = useState(() => initial.error);
  const [balanceRefreshing, setBalanceRefreshing] = useState(false);
  const balanceInFlightRef = useRef<Promise<void> | null>(null);
  const supportsBalance = profile.kind === "official" || balanceQueryProviders.has(profile.provider ?? "");
  const sortable = useSortable({ id: profile.id });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };

  const invalidateBalance = (message: string) => {
    setBalanceInfos([]);
    balanceInfoCache.delete(profile.id);
    setBalanceError(message);
    balanceErrorCache.set(profile.id, message);
    if (authQuotaKey) {
      setAuthQuotaFailure(authQuotaKey, message);
    }
  };

  const fetchBalance = async (manual = false): Promise<void> => {
    // 单飞去重：在途时把同一次请求的 promise 交回给调用方，点击重试的指示器
    // 才能跟随真正落地的那次查询，而不是早退熄灯留下结果未知的真空期
    if (balanceInFlightRef.current) return balanceInFlightRef.current;
    if (!supportsBalance || !profile.show_balance) return;
    if (profile.kind !== "official" && !profile.has_key) {
      invalidateBalance(t("balance.missingApiKey"));
      return;
    }
    const request = (async () => {
      try {
        const result = await api.getProfileBalance(profile.id);
        const infos = result.balance_infos;
        if (!infos[0]) throw new Error("查询未返回余额/用量数据"); // i18n-exempt: 该消息只被当布尔用，界面渲染的是固定文案 balance.queryFailed
        setBalanceError("");
        balanceErrorCache.delete(profile.id);
        setBalanceInfos(infos);
        balanceInfoCache.set(profile.id, infos[0]);
        void api.setProfileBalance(profile.id, infos[0]);
        if (authQuotaKey) {
          setAuthQuotaSuccess(authQuotaKey, infos[0]);
          void api.setProfileBalance(authQuotaKey, infos[0]);
        }
      } catch (error) {
        const message = String(error);
        invalidateBalance(message);
        if (manual) {
          const authInvalid = authQuotaErrorKind(message) === "auth_expired";
          feedback.error(t(authInvalid ? "balance.authInvalidToast" : "balance.queryFailedToast"));
        }
      } finally {
        balanceInFlightRef.current = null;
      }
    })();
    balanceInFlightRef.current = request;
    return request;
  };

  useEffect(() => {
    if (!supportsBalance) return;
    const { error, info } = restoreCachedBalance();
    // 值相同则保持原引用跳过重渲染：切页重挂载时卡片不闪
    setBalanceInfos((current) => (current.length === (info ? 1 : 0) && (info ? current[0] === info : true)) ? current : info ? [info] : []);
    setBalanceError(error);
    // 网络刷新延后到首绘出窗之后：缓存数字先行显示（上面那两行），避免挂载即发的请求
    // 挤占冷启动尾部。两条路各自独立，互不影响：
    // - 冷启动窗口内：激活卡 900ms（等供应商页 500ms 进入动画结束再改内容，避免闪动）、
    //   非激活卡 1200ms——只有这时请求才会拖慢首屏出窗；
    // - 日常（窗口已起来）：0，setTimeout(0) 即下一个宏任务立刻发，切页、聚焦、激活
    //   都是普通刷新，不等。手动刷新按钮同样立即执行。
    const timer = window.setTimeout(() => void fetchBalance(), coldStart ? (active ? 900 : 1200) : 0);
    return () => window.clearTimeout(timer);
    // The root owns the single activation listener; cards only react to its epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activationEpoch, profile.id, profile.show_balance, supportsBalance, authQuotaKey]);

  useEffect(() => {
    if (!active || !supportsBalance || !profile.show_balance) return;
    const timer = window.setInterval(() => void fetchBalance(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
    // The interval only exists for the active profile; activationEpoch handles focus refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, profile.id, profile.show_balance, supportsBalance]);

  // 测连通失败文案：凭证失效的结局走本地化可行动文案，其余保留后端原文
  const connectionFailureToast = (error: string) =>
    authQuotaErrorKind(error) === "auth_expired"
      ? t("connection.testFailed", { error: t("balance.authInvalidToast") })
      : t("connection.failed", { error });

  const testConnection = async () => {
    if (testing) return;
    if (profile.provider && !profile.has_base_url) {
      feedback.warning(t("edit.baseUrlRequired"));
      return;
    }
    if (profile.provider && !profile.has_key) {
      feedback.warning(t("connection.missingApiKeyWarning"));
      return;
    }
    setTesting(true);
    try {
      const result = await api.testProfileConnection(profile.id);
      if (result.ok) {
        feedback.success(t("connection.ok", { latency: result.latency_ms != null ? ` · ${result.latency_ms}ms` : "" }));
      } else {
        feedback.error(connectionFailureToast(result.error ?? t("connection.unknownError")));
      }
    } catch (error) {
      feedback.error(connectionFailureToast(String(error)));
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
        balanceInfos={balanceInfos}
        balanceError={balanceError}
        balanceRefreshing={balanceRefreshing}
        onRefreshBalance={(manual) => {
          setBalanceRefreshing(true);
          void fetchBalance(manual).finally(() => setBalanceRefreshing(false));
        }}
        onOpenAdmin={() => void api.openUrl(profile.admin_url!).catch((error) => feedback.error(String(error)))}
        onRename={onRename}
      />
      <ProfileCardActions active={active} busy={busy} profile={profile} testing={testing} onApply={onApply} onDuplicate={onDuplicate} onTest={() => void testConnection()} onRemove={onRemove} />
    </article>
  );
}
