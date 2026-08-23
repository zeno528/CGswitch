import { Copy, ExternalLink, GripVertical, KeyRound, Monitor, Wallet, Wifi } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { api } from "../../api";
import { balanceChipClass, balanceQueryProviders } from "../../presets";
import type { ProfileBalanceInfo, ProfileSummary } from "../../types";
import { useFeedback } from "../../app/Feedback";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { ProfileIconTile } from "../../components/ProfileIconTile";
import { TrashIcon } from "../../components/TrashIcon";

const balanceInfoCache = new Map<string, ProfileBalanceInfo>();

interface ProfileCardProps {
  profile: ProfileSummary;
  active: boolean;
  busy: boolean;
  activationEpoch: number;
  subscriptionAuthed: boolean;
  subscriptionAccount: string | null;
  subscriptionSource: "desktop" | "oauth" | null;
  boundAccount: string | null;
  balanceCache?: Record<string, ProfileBalanceInfo>;
  onApply: () => void;
  onRename: () => void;
  onEdit: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
}

export default function ProfileCard({
  profile,
  active,
  busy,
  activationEpoch,
  subscriptionAuthed,
  subscriptionAccount,
  subscriptionSource,
  boundAccount,
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
  const [balanceInfo, setBalanceInfo] = useState<ProfileBalanceInfo | null>(null);
  const [balanceError, setBalanceError] = useState("");
  const balanceFetchingRef = useRef(false);
  const supportsBalance = balanceQueryProviders.has(profile.provider ?? "");
  const sortable = useSortable({ id: profile.id });
  const style = { transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition };

  const fetchBalance = async () => {
    if (!supportsBalance || !profile.show_balance || !profile.has_key || balanceFetchingRef.current) return;
    balanceFetchingRef.current = true;
    try {
      const result = await api.getProfileBalance(profile.id);
      setBalanceError("");
      const info = result.balance_infos[0];
      if (info) {
        setBalanceInfo(info);
        balanceInfoCache.set(profile.id, info);
        void api.setProfileBalance(profile.id, info);
      }
    } catch (error) {
      setBalanceError(String(error));
    } finally {
      balanceFetchingRef.current = false;
    }
  };

  useEffect(() => {
    if (!supportsBalance) return;
    setBalanceInfo(balanceInfoCache.get(profile.id) ?? balanceCache?.[profile.id] ?? null);
    void fetchBalance();
    // The root owns the single activation listener; cards only react to its epoch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activationEpoch, profile.id, profile.show_balance, supportsBalance]);

  useEffect(() => setConnectionState("unknown"), [profile.id]);

  const connectionDimmed = !profile.provider ? !subscriptionAuthed : connectionState === "fail" || !profile.has_key;
  const connectionTitle = !profile.provider
    ? subscriptionAuthed ? "测试订阅认证连通性" : "尚未认证 ChatGPT 订阅"
    : !profile.has_key ? "缺少 API 密钥，点击查看提示" : "测试连通性";
  const subscriptionSourceKind = !subscriptionAuthed ? null : boundAccount ? "oauth" : subscriptionSource ?? "oauth";
  const subscriptionTitle = !subscriptionAuthed
    ? "ChatGPT 尚未完成认证，请到设置页登录"
    : boundAccount
      ? `OAuth 认证账号：${boundAccount}`
      : `${subscriptionSourceKind === "desktop" ? "桌面端认证" : "OAuth 认证"}${subscriptionAccount ? `账号：${subscriptionAccount}` : ""}`;

  const testConnection = async () => {
    if (testing) return;
    if (!profile.provider && !subscriptionAuthed) {
      feedback.warning("尚未完成 ChatGPT 订阅认证，请先到设置页登录");
      return;
    }
    if (profile.provider && !profile.has_key) {
      setConnectionState("fail");
      feedback.warning(`「${profile.name}」还没有配置 API 密钥，请先填写后再测试`);
      return;
    }
    setTesting(true);
    try {
      const result = await api.testProfileConnection(profile.id);
      if (result.ok) {
        setConnectionState("ok");
        feedback.success(`「${profile.name}」连接正常${result.latency_ms != null ? ` · ${result.latency_ms}ms` : ""}`);
      } else {
        setConnectionState("fail");
        feedback.error(`「${profile.name}」连接失败：${result.error ?? "未知错误"}`);
      }
    } catch (error) {
      setConnectionState("fail");
      feedback.error(`「${profile.name}」测试失败：${String(error)}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <article
      ref={sortable.setNodeRef}
      data-draggable
      style={style}
      className={`group flex cursor-pointer select-none flex-col gap-4 px-5 py-4 transition-colors sm:flex-row sm:items-center sm:justify-between ${sortable.isDragging ? "opacity-35" : active ? "bg-[linear-gradient(90deg,color-mix(in_srgb,var(--selection-bg)_70%,transparent),transparent_65%)]" : "hover:bg-black/3 dark:hover:bg-white/4"}`}
      title="单击编辑"
      onClick={onEdit}
    >
      <span className="drag-handle -ml-5 -mr-4 grid shrink-0 cursor-grab place-items-center self-center rounded-md py-1 pl-3 pr-3 muted transition-colors hover:opacity-70 active:cursor-grabbing sm:self-stretch" title="拖动排序" aria-label="拖动排序" {...sortable.attributes} {...sortable.listeners} onClick={(event) => event.stopPropagation()}>
        <GripVertical className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <ProfileIconTile name={profile.name} icon={profile.icon} />
        <div className="min-w-0 flex-1">
          <div className="flex min-h-7 items-center gap-2">
            <h3 className="title-md cursor-pointer truncate leading-normal transition-colors hover:text-accent" title="点击重命名" onClick={(event) => { event.stopPropagation(); onRename(); }}>{profile.name}</h3>
            {active ? <span className="inline-flex items-center rounded-full bg-success px-2 py-0.5 text-xs font-semibold leading-none text-white">活动</span> : null}
            {!profile.provider ? <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${subscriptionAuthed ? "bg-accent/10 text-accent" : "bg-black/5 muted dark:bg-white/6"}`} title={subscriptionTitle} aria-label={subscriptionTitle}>
              {subscriptionSourceKind === "desktop" ? <Monitor className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" /> : <KeyRound className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />}
            </span> : null}
          </div>
          <div className="profile-card-meta muted mt-1 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
            <span className="min-w-0 truncate">{profile.model ?? "未设置"}</span>
            {profile.reasoning_effort ? <><span aria-hidden="true">·</span><span className="apple-chip">{profile.reasoning_effort}</span></> : null}
            {supportsBalance && profile.show_balance ? <button type="button" className="apple-chip" title={balanceError ? `余额刷新失败：${balanceError}（显示上次余额，点击重试）` : balanceInfo?.usage_percent != null ? "用量，点击刷新" : "余额，点击刷新"} aria-label="余额" onClick={(event) => { event.stopPropagation(); void fetchBalance(); }}>
              <Wallet className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
              {balanceInfo?.usage_percent != null ? <><span>5小时 </span><span className={balanceChipClass(balanceInfo.usage_percent, false)}>{balanceInfo.usage_percent}%</span>{balanceInfo.usage_reset ? <span> {balanceInfo.usage_reset}</span> : null}{balanceInfo.weekly_usage_percent != null ? <><span> · 7天 </span><span className={balanceChipClass(balanceInfo.weekly_usage_percent, false)}>{balanceInfo.weekly_usage_percent}%</span>{balanceInfo.weekly_reset ? <span> {balanceInfo.weekly_reset}</span> : null}</> : null}</> : balanceInfo ? <><span>余额 </span><span className={balanceChipClass(null, false, balanceInfo.total_balance)}>{balanceInfo.total_balance.startsWith("-") ? "-" : ""}{balanceInfo.currency === "USD" ? "$" : "¥"}{balanceInfo.total_balance.replace(/^-/, "")}</span><span> {balanceInfo.currency}</span></> : <span className={balanceError ? "chip-danger" : ""}>{balanceError ? "查询失败" : "余额 --"}</span>}
            </button> : null}
            {profile.admin_url ? <button type="button" className="grid h-4 w-4 place-items-center rounded-full text-accent transition-colors hover:bg-[var(--profile-chip-bg)]" title="打开官网" aria-label="打开官网" onClick={(event) => { event.stopPropagation(); void api.openUrl(profile.admin_url!).catch((error) => feedback.error(String(error))); }}><ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" /></button> : null}
          </div>
        </div>
      </div>
      <div className="profile-card-actions pointer-events-none flex shrink-0 items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.preventDefault()}>
        <button type="button" className="apple-action-button app-button--primary" disabled={busy || active} onClick={onApply}>{active ? "已应用" : "应用"}</button>
        <button type="button" className="apple-icon-button text-[var(--text-secondary)] hover:bg-[var(--profile-chip-bg)] hover:text-accent" title="复制供应商" aria-label="复制供应商" onClick={onDuplicate}><Copy className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" /></button>
        <button type="button" className={`apple-icon-button enabled:hover:bg-[var(--profile-chip-bg)] disabled:cursor-not-allowed disabled:opacity-40 ${connectionDimmed ? "text-[var(--text-secondary)]" : "text-accent"}`} disabled={(!profile.provider && !subscriptionAuthed) || busy || testing} title={connectionTitle} aria-label="测试连通性" onClick={() => void testConnection()}>{testing ? <LoadingSpinner size="md" /> : <Wifi className="h-[18px] w-[18px]" strokeWidth={2} aria-hidden="true" />}</button>
        <button type="button" className="apple-icon-button text-[var(--danger)]/60 enabled:hover:bg-[var(--danger)]/10 enabled:hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-40" disabled={busy || active} title="删除" aria-label="删除" onClick={onRemove}><TrashIcon /></button>
      </div>
    </article>
  );
}
