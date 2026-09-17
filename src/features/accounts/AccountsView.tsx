import { Check, Copy, CreditCard, ExternalLink, KeyRound, Monitor, Plus, RefreshCw, ShieldCheck } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { PlanBadge } from "../../components/PlanBadge";
import { LoadingSpinner } from "../../components/LoadingSpinner";
import { providerIconUrl } from "../../icons";
import { balanceChipClass } from "../../presets";
import { isWeeklyWindowLabel, localizeBalanceLabel } from "../profiles/balanceLabel";
import type { AuthStatus, BrowserLoginStart, ChatgptResetCredit, DeviceCodeResponse, ProfileBalanceInfo } from "../../types";

const authQuotaCache = new Map<string, ProfileBalanceInfo>();
const chatgptLogo = providerIconUrl("openai-chatgpt");

function authQuotaCacheKey(source: "desktop" | "oauth", accountId?: string) {
  return `auth:${source}:${accountId ?? "codex-external"}`;
}

function remainingPercent(usedPercent: number) {
  return 100 - Math.min(100, Math.max(0, usedPercent));
}

function daysRemaining(time?: number | null) {
  return time == null ? null : Math.max(0, Math.ceil((time - Date.now()) / 86_400_000));
}

function formatLocalTime(time: number, language: string) {
  return new Intl.DateTimeFormat(language, { year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(time);
}

function formatShortLocalTime(time: number, language: string) {
  return new Intl.DateTimeFormat(language, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(time);
}

function localTimeZone(language: string) {
  return new Intl.DateTimeFormat(language, { hour: "numeric", timeZoneName: "short" }).formatToParts().find((part) => part.type === "timeZoneName")?.value ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
}

const quotaProgressAnimationDuration = 1000;

// Match ECharts' default first-render bar animation exactly.
function cubicInOut(value: number) {
  const doubled = value * 2;
  if (doubled < 1) return 0.5 * doubled * doubled * doubled;
  const shifted = doubled - 2;
  return 0.5 * (shifted * shifted * shifted + 2);
}

function QuotaProgressBar({ label, usedPercent, resetAt, resetIn, onRefresh, loading, animationRevision, animationFromRemaining }: { label: string; usedPercent: number; resetAt?: number | null; resetIn?: string | null; onRefresh?: () => void; loading?: boolean; animationRevision: number; animationFromRemaining?: number }) {
  const { t, i18n } = useTranslation("settings");
  // 窗口标签的文案在 profiles 命名空间，另取一个对应的 t
  const { t: tBalance } = useTranslation("profiles");
  const used = Math.min(100, Math.max(0, usedPercent));
  const remaining = remainingPercent(usedPercent);
  const animationStart = animationFromRemaining ?? 0;
  const animationMax = Math.max(animationStart, remaining);
  const animationStartScale = animationMax === 0 ? 1 : animationStart / animationMax;
  const animationEndScale = animationMax === 0 ? 1 : remaining / animationMax;
  const fillClass = used >= 90 ? "bg-(--danger)" : used >= 70 ? "bg-(--warning)" : "bg-(--chip-success)";
  const title = isWeeklyWindowLabel(label) ? t("account.weeklyLimit") : t("account.usageLimit", { label: localizeBalanceLabel(label, tBalance) ?? label });
  // 重置时间按当前界面语言本地化，不写死中文日期习惯
  const reset = resetAt == null ? null : <>{t("account.resetTime", { time: formatShortLocalTime(resetAt, i18n.language) })}{resetIn ? t("account.resetCountdown", { time: resetIn }) : null}</>;
  const fillRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const fill = fillRef.current;
    if (!fill || animationRevision === 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fill.style.transform = `scaleX(${animationEndScale})`;
      return;
    }

    const startedAt = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / quotaProgressAnimationDuration);
      const current = animationStart + (remaining - animationStart) * cubicInOut(progress);
      fill.style.transform = `scaleX(${animationMax === 0 ? 1 : current / animationMax})`;
      if (progress < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [animationRevision]);

  return <div className="min-w-0 space-y-2 text-xs">
    <div className="min-w-0">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="field-subtitle">{title}</span>
          {onRefresh ? <button type="button" className="apple-icon-button h-5 w-5 text-[var(--text-secondary)] hover:bg-(--profile-chip-bg) hover:text-accent" disabled={loading} title={t("account.refreshQuota")} aria-label={t("account.refreshQuota")} onClick={onRefresh}>{loading ? <LoadingSpinner /> : <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />}</button> : null}
        </div>
        <span className="meta-xs shrink-0 whitespace-nowrap">{t("account.remainingShort")} <span className={`font-semibold ${balanceChipClass(used, false)}`}>{remaining}%</span></span>
      </div>
      {reset ? <div className="meta-xs mt-0.5 muted">{reset}</div> : null}
    </div>
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-black/6 dark:bg-white/8" role="progressbar" aria-label={t("account.remainingAria", { title })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining}>
      <span ref={fillRef} key={animationRevision} className={`origin-left block h-full rounded-full ${fillClass}`} style={{ width: `${animationRevision ? animationMax : remaining}%`, transform: animationRevision ? `scaleX(${animationStartScale})` : undefined }} />
    </div>
  </div>;
}

function AccountQuota({ source, accountId, cachedBalance }: { source: "desktop" | "oauth"; accountId?: string; cachedBalance?: ProfileBalanceInfo }) {
  const { t } = useTranslation("settings");
  // 窗口标签的文案在 profiles 命名空间，另取一个对应的 t
  const { t: tBalance } = useTranslation("profiles");
  const cacheKey = authQuotaCacheKey(source, accountId);
  const [quota, setQuota] = useState<ProfileBalanceInfo | null>(() => authQuotaCache.get(cacheKey) ?? cachedBalance ?? null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [animationRevision, setAnimationRevision] = useState(0);
  const [animationFromQuota, setAnimationFromQuota] = useState<ProfileBalanceInfo | null>(null);
  const displayedQuotaRef = useRef(quota);
  const loadingRef = useRef(false);

  const refresh = async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const result = await api.authGetQuota(source, accountId);
      const info = result.balance_infos[0];
      if (!info) throw new Error("额度查询未返回数据"); // i18n-exempt: 内部错误信息，界面只按 error 真假渲染固定文案
      const previousQuota = displayedQuotaRef.current;
      displayedQuotaRef.current = info;
      setAnimationFromQuota(previousQuota);
      setQuota(info);
      setAnimationRevision((revision) => revision + 1);
      authQuotaCache.set(cacheKey, info);
      // 复用现有持久化余额缓存，只用 auth 命名空间隔离账号。
      void api.setProfileBalance(cacheKey, info);
      setError("");
    } catch (cause) {
      displayedQuotaRef.current = null;
      setQuota(null);
      authQuotaCache.delete(cacheKey);
      setError(String(cause));
    }
    finally {
      loadingRef.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    const nextQuota = authQuotaCache.get(cacheKey) ?? cachedBalance ?? null;
    displayedQuotaRef.current = nextQuota;
    setQuota(nextQuota);
    void refresh();
    // Cache identity changes are the only reload trigger; refresh keeps the latest value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey]);

  // 后端回传的窗口标签按当前语言换词；后端没给时才用本语言兜底（映射见 balanceLabel.ts）
  const primaryLabel = localizeBalanceLabel(quota?.usage_label, tBalance) ?? t("account.quotaLabel");
  const weeklyLabel = localizeBalanceLabel(quota?.weekly_label, tBalance) ?? t("account.periodLabel");

  return <div className="mt-3 border-t border-[var(--panel-divider)] pt-2">{quota?.usage_percent != null ? <div className="space-y-2"><QuotaProgressBar label={primaryLabel} usedPercent={quota.usage_percent} resetAt={quota.usage_reset_at} resetIn={quota.usage_reset} onRefresh={() => void refresh()} loading={loading} animationRevision={animationRevision} animationFromRemaining={animationFromQuota?.usage_percent == null ? undefined : remainingPercent(animationFromQuota.usage_percent)} />{quota.weekly_usage_percent != null ? <QuotaProgressBar label={weeklyLabel} usedPercent={quota.weekly_usage_percent} resetAt={quota.weekly_reset_at} resetIn={quota.weekly_reset} animationRevision={animationRevision} animationFromRemaining={animationFromQuota?.weekly_usage_percent == null ? undefined : remainingPercent(animationFromQuota.weekly_usage_percent)} /> : null}</div> : <p className={`mt-1 text-xs ${error ? "text-[var(--danger)]" : "muted"}`}>{error ? t("account.quotaFailed") : t("account.quotaLoading")}</p>}{quota && (quota.reset_credits_available ?? 0) > 0 ? <ResetCredits availableCount={quota.reset_credits_available ?? 0} credits={quota.reset_credits} /> : null}</div>;
}

function ResetCredits({ availableCount, credits }: { availableCount: number; credits?: ChatgptResetCredit[] | null }) {
  const { t, i18n } = useTranslation("settings");
  const formatExpiry = (expiresAt?: number | null) => expiresAt == null ? t("account.resetCreditExpiryUnknown") : formatShortLocalTime(expiresAt, i18n.language);
  const resetTitle = (resetType?: string | null) => ["full", "codex_rate_limits"].includes(resetType ?? "")
    ? t("account.resetCreditFullTitle")
    : t("account.resetCreditTitle");

  return <section className="mt-3 border-t border-[var(--panel-divider)] pt-3">
    <div className="flex items-center gap-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><CreditCard className="h-[18px] w-[18px]" strokeWidth={2} /></span>
      <div className="flex min-w-0 items-baseline gap-2"><div className="setting-title">{t("account.resetCreditsTitle")}</div><div className="setting-description">{t("account.resetCredits", { count: availableCount })}</div></div>
    </div>
    {credits?.length ? <div className="mt-3 divide-y divide-[var(--panel-divider)]">
      {credits.map((credit) => {
        const days = daysRemaining(credit.expires_at);
        return <div key={credit.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 first:pt-0 last:pb-0"><div className="field-subtitle min-w-0">{resetTitle(credit.reset_type)}</div><div className="whitespace-nowrap text-xs">{t("account.resetCreditExpiry", { time: formatExpiry(credit.expires_at) })}{days == null ? null : <span className="muted"> · {t("account.resetCreditDaysRemaining", { count: days })}</span>}</div></div>;
      })}
    </div> : null}
  </section>;
}

function SubscriptionExpiry({ plan, expiresAt }: { plan?: string | null; expiresAt?: number | null }) {
  const { t, i18n } = useTranslation("settings");
  const subscriptionExpiry = plan?.toLowerCase() === "free" ? null : expiresAt;
  if (!plan && !subscriptionExpiry) return null;
  const days = daysRemaining(subscriptionExpiry);
  return <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1"><PlanBadge plan={plan ?? null} />{subscriptionExpiry ? <span className="meta-xs muted">{t("account.subscriptionRenewal", { time: formatLocalTime(subscriptionExpiry, i18n.language), timeZone: localTimeZone(i18n.language) })}{days == null ? null : <> · {t("account.subscriptionDaysRemaining", { count: days })}</>}</span> : null}</div>;
}

export default function AccountsView({ initialStatus, balanceCache }: { initialStatus: AuthStatus; balanceCache?: Record<string, ProfileBalanceInfo> }) {
  const feedback = useFeedback();
  const { t } = useTranslation("settings");
  const [status, setStatus] = useState(initialStatus);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<DeviceCodeResponse | null>(null);
  const [browserLogin, setBrowserLogin] = useState<BrowserLoginStart | null>(null);
  const [copied, setCopied] = useState(false);
  const disposed = useRef(false);
  const pollCancelled = useRef(false);
  const copyResetTimer = useRef<number | undefined>(undefined);

  const refreshStatus = async () => {
    try { const next = await api.authGetStatus(); if (!disposed.current) { setStatus(next); setLoadError(""); } }
    catch (error) { if (!disposed.current) setLoadError(String(error)); }
  };
  useEffect(() => { disposed.current = false; void refreshStatus(); return () => { disposed.current = true; if (copyResetTimer.current !== undefined) window.clearTimeout(copyResetTimer.current); }; }, []);
  useEffect(() => setStatus(initialStatus), [initialStatus]);

  const poll = async (current: DeviceCodeResponse) => {
    try {
      const deadline = Date.now() + current.expires_in * 1000;
      while (!disposed.current && !pollCancelled.current && Date.now() < deadline) {
        const account = await api.authPollForAccount(current.device_code);
        if (account) { setLogin(null); await refreshStatus(); feedback.success(t("account.addedToast")); break; }
        await new Promise((resolve) => window.setTimeout(resolve, current.interval * 1000));
      }
    } catch (error) { if (!disposed.current) { feedback.error(String(error)); setLogin(null); } }
    finally { if (!disposed.current) setBusy(false); }
  };

  const pollBrowser = async (current: BrowserLoginStart) => {
    try {
      const deadline = Date.now() + current.expires_in * 1000;
      while (!disposed.current && !pollCancelled.current && Date.now() < deadline) {
        const account = await api.authPollBrowserLogin();
        if (account) { setBrowserLogin(null); await refreshStatus(); feedback.success(t("account.addedToast")); return; }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
      if (!disposed.current && !pollCancelled.current) { setBrowserLogin(null); feedback.error(t("account.loginTimeout")); }
    } catch (error) { if (!disposed.current) { feedback.error(String(error)); setBrowserLogin(null); } }
    finally { if (!disposed.current) setBusy(false); }
  };

  // 主路径：浏览器授权码登录（PKCE 回环回调），无需手动输入设备码
  const startLogin = async () => {
    if (busy) return;
    setBusy(true); setLogin(null); setBrowserLogin(null); pollCancelled.current = false;
    try { const next = await api.authStartBrowserLogin(); setBrowserLogin(next); await api.openUrl(next.authorize_url); void pollBrowser(next); }
    catch (error) { const text = String(error); feedback.error(text.includes("unsupported_country_region_territory") ? t("account.regionBlocked") : text); setBusy(false); }
  };

  // 后备路径：设备码登录（本地回调端口不可用等场景）
  const startDeviceLogin = async () => {
    if (busy) return;
    setBusy(true); setBrowserLogin(null); setLogin(null); setCopied(false); pollCancelled.current = false;
    try { const next = await api.authStartLogin(); setLogin(next); await api.openUrl(next.verification_uri); void poll(next); }
    catch (error) { const text = String(error); feedback.error(text.includes("unsupported_country_region_territory") ? t("account.regionBlocked") : text); setBusy(false); }
  };

  const cancelBrowserLogin = () => {
    pollCancelled.current = true;
    void api.authCancelBrowserLogin().catch(() => {});
    setBrowserLogin(null);
    setBusy(false);
  };

  const copyUserCode = async () => {
    if (!login) return;
    try {
      await navigator.clipboard.writeText(login.user_code);
      setCopied(true);
      if (copyResetTimer.current !== undefined) window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch { feedback.error(t("account.copyFailed")); }
  };

  const removeAccount = async (accountId: string) => {
    if (!await feedback.confirm({ title: t("account.removeTitle"), description: t("account.removeDescription"), confirmText: t("account.remove"), destructive: true })) return;
    try { await api.authRemoveAccount(accountId); feedback.success(t("account.removedToast")); await refreshStatus(); }
    catch (error) { feedback.error(String(error)); }
  };

  const page = (content: ReactNode) => (
    <section className="accounts-page apple-edit-page mx-auto flex w-full max-w-none flex-col">
      <header className="apple-page-bar justify-between gap-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="settings-icon-tile grid h-9 w-9 shrink-0 place-items-center rounded-[10px]">
            {chatgptLogo ? <img src={chatgptLogo} alt="" className="h-[18px] w-[18px] invert dark:invert-0" /> : null}
          </span>
          <span className="apple-title">{t("account.sectionTitle")}</span>
        </div>
        {!browserLogin && !login ? <button type="button" className="apple-action-button app-button--primary" disabled={busy} onClick={() => void startLogin()}><Plus className="h-4 w-4" strokeWidth={2} />{t("account.addAnother")}</button> : null}
      </header>
      <div className="apple-edit-content">{content}</div>
    </section>
  );

  if (browserLogin) return page(
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><ShieldCheck className="h-[18px] w-[18px]" strokeWidth={2} /></span>
          <div><div className="setting-title">{t("account.browserLoginTitle")}</div><p className="setting-description mt-0.5">{t("account.browserLoginDescription")}</p></div>
        </div>
        <span className="apple-chip chip-warn" role="status"><LoadingSpinner />{t("account.waitingAuth")}</span>
      </div>
      <div className="apple-group p-3">
        <button type="button" className="apple-action-button w-full" onClick={() => void api.openUrl(browserLogin.authorize_url)}><ExternalLink className="h-4 w-4" strokeWidth={2} />{t("account.reopenBrowser")}</button>
        <div className="mt-4 flex flex-col items-center gap-2">
          <button type="button" className="apple-action-button" onClick={cancelBrowserLogin}>{t("account.cancelLogin")}</button>
          <button type="button" className="text-xs text-(--text-secondary) hover:text-accent hover:underline" onClick={() => void startDeviceLogin()}>{t("account.deviceFallback")}</button>
        </div>
      </div>
    </div>
  );

  if (login) return page(
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><ShieldCheck className="h-[18px] w-[18px]" strokeWidth={2} /></span>
          <div><div className="setting-title">{t("account.deviceLoginTitle")}</div><p className="setting-description mt-0.5">{t("account.deviceLoginDescription")}</p></div>
        </div>
        <span className="apple-chip chip-warn" role="status"><LoadingSpinner />{t("account.waitingAuth")}</span>
      </div>
      <div className="apple-group p-3">
        <div className="text-center">
          <div className="field-label">{t("account.authCodeLabel")}</div>
          <div className="mt-2 flex items-center justify-center gap-2">
            <code className="mono whitespace-nowrap rounded-lg bg-black/8 px-4 py-2 text-2xl font-bold tracking-[0.3em] dark:bg-white/8">{login.user_code}</code>
            <button type="button" className={`grid h-8 w-8 place-items-center rounded-full ${copied ? "bg-success/10 text-success" : "text-accent hover:bg-(--profile-chip-bg)"}`} title={copied ? t("account.copied") : t("account.copyCode")} aria-label={copied ? t("account.codeCopied") : t("account.copyCode")} onClick={() => void copyUserCode()}>{copied ? <Check className="h-4 w-4" strokeWidth={2} /> : <Copy className="h-4 w-4" strokeWidth={2} />}</button>
          </div>
        </div>
        <div className="mt-3 border-t border-[var(--panel-border)] pt-3 text-center"><div className="muted text-xs">{t("account.authPage")}</div><button type="button" className="mt-1 flex w-full min-w-0 items-center justify-center gap-1.5 text-sm font-medium text-accent hover:underline" title={login.verification_uri} onClick={() => void api.openUrl(login.verification_uri)}><span className="truncate">{login.verification_uri}</span><ExternalLink className="h-4 w-4 shrink-0" strokeWidth={2} /></button></div>
        <div className="mt-4 flex justify-center"><button type="button" className="apple-action-button" onClick={() => { pollCancelled.current = true; setLogin(null); setBusy(false); }}>{t("account.cancelLogin")}</button></div>
      </div>
    </div>
  );

  if (status.authenticated) return page(
    <div className="grid grid-cols-1 gap-[var(--gap-card)] md:grid-cols-2">
      {status.external ? <div className="apple-group p-3"><div className="flex min-w-0 flex-nowrap items-center gap-3"><Monitor className="h-5 w-5 shrink-0 text-accent" strokeWidth={2} /><div className="flex min-w-0 flex-1 items-baseline gap-2 whitespace-nowrap"><span className="mono min-w-0 truncate title-sm">{status.external.login}</span><span className="apple-chip muted shrink-0">{t("account.followCodex")}</span></div></div><SubscriptionExpiry plan={status.external.plan_type} expiresAt={status.external.subscription_active_until} /><AccountQuota source="desktop" accountId={status.external.id} cachedBalance={balanceCache?.[authQuotaCacheKey("desktop", status.external.id)]} /></div> : null}
      {status.accounts.map((account) => <div key={account.id} className="apple-group p-3"><div className="flex min-w-0 flex-nowrap items-center gap-3"><KeyRound className="h-5 w-5 shrink-0 text-accent" strokeWidth={2} /><div className="flex min-w-0 flex-1 items-baseline gap-2 whitespace-nowrap"><span className="mono min-w-0 truncate title-sm">{account.login}</span><span className="apple-chip muted shrink-0">{t("account.oauthDeviceLogin")}</span></div><button type="button" className="apple-action-button apple-action-button--compact shrink-0 whitespace-nowrap text-[var(--danger)]" onClick={() => void removeAccount(account.id)}>{t("account.remove")}</button></div><SubscriptionExpiry plan={account.plan_type} expiresAt={account.subscription_active_until} /><AccountQuota source="oauth" accountId={account.id} cachedBalance={balanceCache?.[authQuotaCacheKey("oauth", account.id)]} /></div>)}
    </div>
  );

  return page(<div><div className="apple-group p-3"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><ShieldCheck className="h-[18px] w-[18px]" strokeWidth={2} /></span><div><div className="setting-title">{t("account.notConnected")}</div><p className="setting-description mt-0.5">{t("account.notConnectedDescription")}</p></div></div></div>{loadError ? <p className="muted mt-3 text-sm">{loadError}</p> : null}</div>);
}
