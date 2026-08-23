import { CircleCheck, Copy, ExternalLink, KeyRound, Monitor, Plus, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import type { AuthStatus, DeviceCodeResponse } from "../../types";

export default function ChatGPTAccount({ initialStatus }: { initialStatus: AuthStatus }) {
  const feedback = useFeedback();
  const [status, setStatus] = useState(initialStatus);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [login, setLogin] = useState<DeviceCodeResponse | null>(null);
  const disposed = useRef(false);
  const pollCancelled = useRef(false);

  const refreshStatus = async () => {
    try { const next = await api.authGetStatus(); if (!disposed.current) { setStatus(next); setLoadError(""); } }
    catch (error) { if (!disposed.current) setLoadError(String(error)); }
  };
  useEffect(() => { disposed.current = false; void refreshStatus(); return () => { disposed.current = true; }; }, []);
  useEffect(() => setStatus(initialStatus), [initialStatus]);

  const poll = async (current: DeviceCodeResponse) => {
    try {
      const deadline = Date.now() + current.expires_in * 1000;
      while (!disposed.current && !pollCancelled.current && Date.now() < deadline) {
        const account = await api.authPollForAccount(current.device_code);
        if (account) { setLogin(null); await refreshStatus(); feedback.success("ChatGPT 账号已添加，可在配置中选择"); break; }
        await new Promise((resolve) => window.setTimeout(resolve, current.interval * 1000));
      }
    } catch (error) { if (!disposed.current) { feedback.error(String(error)); setLogin(null); } }
    finally { if (!disposed.current) setBusy(false); }
  };

  const startLogin = async () => {
    if (busy) return;
    setBusy(true); setLogin(null); pollCancelled.current = false;
    try { const next = await api.authStartLogin(); setLogin(next); await api.openUrl(next.verification_uri); void poll(next); }
    catch (error) { const text = String(error); feedback.error(text.includes("unsupported_country_region_territory") ? "认证请求被地区限制拦截。请开启系统代理并确认节点位于 ChatGPT 支持的地区后重试。" : text); setBusy(false); }
  };

  const removeAccount = async (accountId: string) => {
    if (!await feedback.confirm({ title: "移除订阅账号", description: "确定移除该 ChatGPT 订阅账号吗？移除后本机将清除该账号的登录凭据。", confirmText: "移除", destructive: true })) return;
    try { await api.authRemoveAccount(accountId); feedback.success("账号已移除"); await refreshStatus(); }
    catch (error) { feedback.error(String(error)); }
  };

  if (login) return <div className="space-y-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><ShieldCheck className="h-[18px] w-[18px]" strokeWidth={2} /></span><div><div className="setting-title">ChatGPT 设备码登录</div><p className="setting-description mt-0.5">完成 ChatGPT 登录后，认证结果会自动回到这里。</p></div></div><span className="apple-chip chip-warn">等待授权</span></div><div className="rounded-[var(--radius-card)] bg-accent/6 p-4 shadow-[0_0_0_1px_var(--panel-ring)] dark:bg-accent/10"><div className="text-center"><div className="field-label">授权码：请在浏览器中输入此码</div><div className="mt-1 flex items-center justify-center gap-2"><span className="mono whitespace-nowrap text-2xl font-bold tracking-[0.3em]">{login.user_code}</span><button type="button" className="grid h-8 w-8 place-items-center rounded-full text-accent hover:bg-[var(--profile-chip-bg)]" title="复制授权码" onClick={() => void navigator.clipboard.writeText(login.user_code).then(() => feedback.success("授权码已复制")).catch(() => feedback.error("复制失败，请手动选择复制"))}><Copy className="h-4 w-4" strokeWidth={2} /></button></div></div><div className="mt-3 border-t border-[var(--panel-border)] pt-3 text-center"><div className="muted text-xs">授权页面</div><button type="button" className="mt-1 flex w-full min-w-0 items-center justify-center gap-1.5 text-sm font-medium text-accent hover:underline" title={login.verification_uri} onClick={() => void api.openUrl(login.verification_uri)}><span className="truncate">{login.verification_uri}</span><ExternalLink className="h-4 w-4 shrink-0" strokeWidth={2} /></button></div><div className="mt-4 flex justify-center"><button type="button" className="apple-action-button" onClick={() => { pollCancelled.current = true; setLogin(null); setBusy(false); }}>取消登录</button></div></div></div>;

  if (status.authenticated) return <div className="space-y-4"><div className="flex items-start justify-between gap-3 rounded-[var(--radius-card)] bg-success/10 p-3 shadow-[0_0_0_1px_rgba(52,199,89,0.16)]"><div className="flex min-w-0 items-start gap-3"><CircleCheck className="mt-2 h-6 w-6 shrink-0 text-success" strokeWidth={2} /><div><div className="setting-title">{status.external && status.accounts.length ? "ChatGPT 已认证" : status.external ? "ChatGPT 桌面端已登录" : "ChatGPT 设备码登录已生效"}</div><p className="setting-description mt-0.5">{status.external && status.accounts.length ? "桌面端 Codex 与设备码登录均已连接。" : status.external ? "来自 ChatGPT 桌面端的 Codex 登录状态。" : "当前使用通过设备码登录的 ChatGPT 账号。"}</p></div></div></div>{status.external ? <div className="space-y-2"><div className="setting-title">桌面端登录</div><div className="flex items-center gap-3 rounded-xl bg-info/8 px-3 py-2.5 shadow-[0_0_0_1px_var(--panel-ring)]"><Monitor className="h-5 w-5 shrink-0 text-info" strokeWidth={2} /><span className="mono truncate text-sm font-medium">{status.external.login}</span></div></div> : null}{status.accounts.length ? <div className="space-y-2"><div className="setting-title">OAuth 设备码登录</div><p className="setting-description">通过设备码登录添加，可在 CGswitch 中管理多个账号。</p>{status.accounts.map((account) => <div key={account.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 shadow-[0_0_0_1px_var(--panel-ring)]"><KeyRound className="h-5 w-5 shrink-0 text-accent" strokeWidth={2} /><span className="mono min-w-0 flex-1 truncate text-sm font-medium">{account.login}</span><button type="button" className="apple-action-button text-[var(--danger)]" onClick={() => void removeAccount(account.id)}>移除</button></div>)}</div> : null}<button type="button" className="apple-action-button" disabled={busy} onClick={() => void startLogin()}><Plus className="h-4 w-4" strokeWidth={2} />添加其他账号</button></div>;

  return <div><div className="rounded-[var(--radius-card)] border border-[var(--panel-border)] bg-black/2 p-3 dark:bg-white/4"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent"><ShieldCheck className="h-[18px] w-[18px]" strokeWidth={2} /></span><div><div className="setting-title">尚未连接 ChatGPT</div><p className="setting-description mt-0.5">登录后可管理多个 ChatGPT 账号。</p></div></div><div className="mt-4"><button type="button" className="apple-action-button app-button--primary" disabled={busy} onClick={() => void startLogin()}><ExternalLink className="h-4 w-4" strokeWidth={2} />使用 ChatGPT 登录</button></div></div>{loadError ? <p className="muted mt-3 text-sm">{loadError}</p> : null}</div>;
}
