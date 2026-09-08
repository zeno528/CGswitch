import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Download, LoaderCircle, X } from "lucide-react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { checkForAppUpdate, UPDATED_VERSION_KEY, type AppUpdate } from "./appUpdate";
import { updateFailureMessage } from "./updateText";

/** 更新日志入口：直接打开对应版本的 GitHub Release 页，避免 /latest 重定向。 */
export const releaseNotesUrl = (version: string) => `https://github.com/zeno528/CGswitch/releases/tag/v${encodeURIComponent(version.replace(/^v/, ""))}`;
interface AppUpdateContextValue {
  /** 已发现的可用更新；null 表示已是最新或尚未检查 */
  update: AppUpdate | null;
  checking: boolean;
  installing: boolean;
  /** 检查更新：结果写入 context，失败时抛错由调用方决定是否提示 */
  check: () => Promise<AppUpdate | null>;
  /** 用户点击升级后才执行：下载安装并重启 */
  install: () => Promise<void>;
}

const AppUpdateContext = createContext<AppUpdateContextValue | null>(null);

export function useAppUpdate() {
  const value = useContext(AppUpdateContext);
  if (!value) throw new Error("useAppUpdate 必须在 AppUpdateProvider 内使用");
  return value;
}

export function AppUpdateProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const feedback = useFeedback();
  const [update, setUpdate] = useState<AppUpdate | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  // StrictMode 下 effect 双跑共用同一组件实例，state 守卫两次都读到旧值，必须用 ref 防重入
  const autoCheckedRef = useRef(false);
  const checkingRef = useRef(false);

  const check = useCallback(async (): Promise<AppUpdate | null> => {
    if (checkingRef.current) return update;
    checkingRef.current = true;
    setChecking(true);
    try {
      const found = await checkForAppUpdate();
      setUpdate(found);
      return found;
    } finally {
      checkingRef.current = false;
      setChecking(false);
    }
  }, [update]);

  // 启动时静默检查一次：发现新版只让状态栏图标出现，不弹出悬浮卡片、不自动下载
  useEffect(() => {
    if (!enabled || autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void check().catch((error) => console.warn("自动检查更新失败：", updateFailureMessage(error)));
  }, [enabled, check]);

  // 应用内更新重启回来：读到安装时留下的版本标记即弹「更新成功」通知（与 enabled 无关，标记只会在更新后存在一次）。
  // 标记由后端原子落盘（Windows 安装器会立即杀进程，localStorage 异步提交可能丢）；
  // 旧版本写在 localStorage 的键也兜底消费一次，覆盖升级过渡期
  useEffect(() => {
    void (async () => {
      const legacy = localStorage.getItem(UPDATED_VERSION_KEY);
      if (legacy) localStorage.removeItem(UPDATED_VERSION_KEY);
      const updatedVersion = legacy ?? (await api.takeUpdateMarker().catch(() => null));
      if (!updatedVersion) return;
      feedback.success(`已更新到 v${updatedVersion}`);
    })();
  }, [feedback]);

  const install = useCallback(async () => {
    if (!update || installing) return;
    setInstalling(true);
    try {
      await update.install();
    } catch (error) {
      feedback.error(updateFailureMessage(error));
    } finally {
      setInstalling(false);
    }
  }, [update, installing, feedback]);

  return <AppUpdateContext.Provider value={{ update, checking, installing, check, install }}>{children}</AppUpdateContext.Provider>;
}

/** 状态栏更新图标：点击后展开可交互的更新卡片。 */
export function UpdateNotice() {
  const { update, installing, install } = useAppUpdate();
  const feedback = useFeedback();
  const [open, setOpen] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!update) setOpen(false);
  }, [update]);
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (noticeRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);
  if (!update) return null;
  const closePopover = () => setOpen(false);
  const openChangelog = () => {
    closePopover();
    void api.openUrl(releaseNotesUrl(update.version)).catch((error) => feedback.error(String(error)));
  };
  return (
    <div ref={noticeRef} className="update-notice">
      <button type="button" className="update-notice-trigger" aria-label={`发现新版本 v${update.version}`} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((value) => !value)}>
        <span className="grid h-6 w-6 place-items-center rounded-full bg-success text-[var(--panel-bg)]">
          <Download className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
        </span>
      </button>
      {open ? (
        <div className="update-notice-popover">
          <button type="button" className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full text-[var(--text-secondary)] hover:bg-(--profile-chip-bg) hover:text-[var(--text-primary)]" aria-label="关闭更新提示" onClick={closePopover}>
            <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
          </button>
          <div className="pr-7 text-sm font-semibold">发现新版本 v{update.version}</div>
          <p className="muted meta-xs mt-1">下载并安装新版本，完成后自动重启</p>
          <div className="mt-2.5 flex flex-nowrap gap-2">
            <button type="button" className="apple-action-button" title="在 GitHub 查看最新发行版" onClick={openChangelog}>
              更新日志
            </button>
            <button type="button" className="apple-action-button app-button--primary" disabled={installing} onClick={() => void install()}>
              {installing ? <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" /> : null}
              {installing ? "下载安装中…" : "立即升级"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
