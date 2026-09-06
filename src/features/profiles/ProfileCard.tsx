import { Check, Copy, ExternalLink, GripVertical, KeyRound, Monitor, Wallet, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../../api";
import { balanceChipClass, balanceQueryProviders, usageQueryProviders } from "../../presets";
import type { ProfileBalanceInfo, ProfileSummary } from "../../types";
import { useFeedback } from "../../app/Feedback";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { ProfileIconTile } from "../../components/ProfileIconTile";
import { TrashIcon } from "../../components/TrashIcon";

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
  const balanceInfo = balanceInfos[0] ?? null;
  const isSubscriptionProfile = profile.kind === "official";
  const supportsBalance = isSubscriptionProfile || balanceQueryProviders.has(profile.provider ?? "");
  const isUsageProvider = usageQueryProviders.has(profile.provider ?? "");
  const authSource = profile.auth_source ?? (profile.account_id ? "oauth" : "desktop");
  const authTitle = `${authSource === "desktop" ? "Codex登录" : "OAuth登录"}${subscriptionAuthed ? "" : "（未登录）"}`;
  const primaryLabel = balanceInfo?.usage_label ?? (isUsageProvider ? "5小时" : "额度");
  const weeklyLabel = balanceInfo?.weekly_label ?? (isUsageProvider ? "7天" : "周期");
  const balanceLabel = isSubscriptionProfile ? "额度" : isUsageProvider ? "用量" : "余额";
  const primaryUsagePercent = balanceInfo?.usage_percent != null ? (isSubscriptionProfile ? 100 - balanceInfo.usage_percent : balanceInfo.usage_percent) : null;
  const weeklyUsagePercent = balanceInfo?.weekly_usage_percent != null ? (isSubscriptionProfile ? 100 - balanceInfo.weekly_usage_percent : balanceInfo.weekly_usage_percent) : null;
  const primaryUsageText = isSubscriptionProfile ? `${primaryLabel}剩余 ` : isUsageProvider ? `${primaryLabel}:` : `${primaryLabel} `;
  const weeklyUsageText = isSubscriptionProfile ? `${weeklyLabel}剩余 ` : isUsageProvider ? `${weeklyLabel}:` : `${weeklyLabel} `;

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <ProfileIconTile name={profile.name} icon={profile.icon} />
      <div className="profile-card-content__text min-w-0 flex-1">
        <div className="flex min-h-7 items-center gap-2">
          <h3 className="title-md cursor-pointer truncate leading-normal transition-colors hover:text-accent" title="点击重命名" onClick={(event) => { event.stopPropagation(); onRename?.(); }}>{profile.name}</h3>
          {!profile.provider ? <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${subscriptionAuthed ? "bg-accent/10 text-accent" : "bg-black/5 muted dark:bg-white/6"}`} title={authTitle} aria-label={authTitle}>
            {authSource === "desktop" ? <Monitor className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" /> : <KeyRound className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />}
          </span> : null}
        </div>
        <div className="profile-card-meta muted mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          <span className="min-w-0 truncate">{profile.model ?? "未设置"}</span>
          {profile.reasoning_effort ? <><span aria-hidden="true">·</span><span className="apple-chip">{profile.reasoning_effort}</span></> : null}
          {supportsBalance && profile.show_balance ? <button type="button" className="apple-chip" title={balanceError ? "查询失败（点击重试）" : "点击刷新"} aria-label={isSubscriptionProfile ? "ChatGPT额度" : balanceLabel} onClick={(event) => { event.stopPropagation(); onRefreshBalance?.(); }}>
            <Wallet className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            {balanceError ? <span className="chip-danger">查询失败</span> : primaryUsagePercent != null ? <><span>{primaryUsageText}</span><span className={balanceChipClass(balanceInfo?.usage_percent ?? null, false)}>{primaryUsagePercent}%</span>{balanceInfo?.usage_reset ? <span> {balanceInfo.usage_reset}</span> : null}{weeklyUsagePercent != null ? <><span> · {weeklyUsageText}</span><span className={balanceChipClass(balanceInfo?.weekly_usage_percent ?? null, false)}>{weeklyUsagePercent}%</span>{balanceInfo?.weekly_reset ? <span> {balanceInfo.weekly_reset}</span> : null}</> : null}</> : balanceInfo && !isUsageProvider ? <><span>余额: </span>{balanceInfos.map((info, index) => <span key={info.currency || index} className="inline-flex items-center gap-1">{index > 0 ? <span aria-hidden="true">/</span> : null}<span className={balanceChipClass(null, false, info.total_balance)}>{info.total_balance.startsWith("-") ? "-" : ""}{info.currency === "USD" ? "$" : "¥"}{info.total_balance.replace(/^-/, "")}</span><span> {info.currency}</span></span>)}</> : <span>{`${balanceLabel} --`}</span>}
          </button> : null}
          {profile.admin_url ? <button type="button" className="grid h-4 w-4 place-items-center rounded-full text-accent transition-colors hover:bg-(--profile-chip-bg)" title="打开官网" aria-label="打开官网" onClick={(event) => { event.stopPropagation(); onOpenAdmin?.(); }}><ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /></button> : null}
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
  return (
    <div className={dragging ? "profile-card-actions profile-card-actions--dragging flex shrink-0 items-center gap-2" : "profile-card-actions pointer-events-none flex shrink-0 items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"} onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.preventDefault()}>
      <button type="button" className="apple-action-button app-button--primary" disabled={busy || active} onClick={onApply}>{active ? <><Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden="true" />使用中</> : "切换"}</button>
      <button type="button" className="apple-icon-button text-[var(--text-secondary)] hover:bg-(--profile-chip-bg) hover:text-accent" title="复制供应商" aria-label="复制供应商" onClick={onDuplicate}><Copy className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" /></button>
      <button type="button" className={`apple-icon-button enabled:hover:bg-(--profile-chip-bg) disabled:cursor-not-allowed disabled:opacity-40 ${connectionDimmed ? "text-[var(--text-secondary)]" : "text-accent"}`} disabled={connectionDimmed || busy || testing} title={connectionTitle} aria-label="测试连通性" onClick={onTest}>{testing ? <LoadingSpinner size="md" /> : <Wifi className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />}</button>
      <button type="button" className="apple-icon-button text-[var(--danger)]/60 enabled:hover:bg-(--danger)/10 enabled:hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || active} title="删除" aria-label="删除" onClick={onRemove}><TrashIcon /></button>
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
      invalidateBalance("缺少 API 密钥");
      return;
    }
    balanceFetchingRef.current = true;
    try {
      const result = await api.getProfileBalance(profile.id);
      const infos = result.balance_infos;
      if (!infos[0]) throw new Error("查询未返回余额/用量数据");
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
    ? subscriptionAuthed ? "测试订阅认证连通性" : "尚未认证 ChatGPT 订阅"
    : !profile.has_key ? "缺少 API 密钥，点击查看提示" : "测试连通性";
  const testConnection = async () => {
    if (testing) return;
    if (!profile.provider && !subscriptionAuthed) {
      feedback.warning("尚未完成 ChatGPT 订阅认证，请先到设置页登录");
      return;
    }
    if (profile.provider && !profile.has_key) {
      setConnectionState("fail");
      feedback.warning("还没有配置 API 密钥，请先填写后再测试");
      return;
    }
    setTesting(true);
    try {
      const result = await api.testProfileConnection(profile.id);
      if (result.ok) {
        setConnectionState("ok");
        feedback.success(`连接正常${result.latency_ms != null ? ` · ${result.latency_ms}ms` : ""}`);
      } else {
        setConnectionState("fail");
        feedback.error(`连接失败：${result.error ?? "未知错误"}`);
      }
    } catch (error) {
      setConnectionState("fail");
      feedback.error(`测试失败：${String(error)}`);
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
      className={`apple-group${active ? " is-active" : ""}${dragHover ? " is-drag-hover" : ""} group flex cursor-pointer select-none flex-col gap-4 px-5 py-4.5 transition-opacity duration-150 sm:flex-row sm:items-center sm:justify-between ${sortable.isDragging ? "pointer-events-none opacity-0" : "opacity-100"}`}
      title="单击编辑"
      onClick={onEdit}
    >
      <span className="drag-handle -ml-5 -mr-4 grid shrink-0 cursor-grab place-items-center self-center rounded-md py-1 pl-3 pr-3 muted transition-colors hover:opacity-70 active:cursor-grabbing sm:self-stretch" title="拖动排序" aria-label="拖动排序" {...sortable.attributes} {...sortable.listeners} onClick={(event) => event.stopPropagation()}>
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
