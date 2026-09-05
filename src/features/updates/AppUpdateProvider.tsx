import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpCircle, LoaderCircle } from "lucide-react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { checkForAppUpdate, type AppUpdate } from "./appUpdate";
import { updateFailureMessage } from "./updateText";

/** 更新日志入口：GitHub 最新 Release 页 */
export const releaseNotesUrl = "https://github.com/zeno528/CGswitch/releases/latest";

interface AppUpdateContextValue {
  /** 已发现的可用更新；null 表示已是最新或尚未检查 */
  update: AppUpdate | null;
  checking: boolean;
  installing: boolean;
  /** 检查更新：结果写入 context（横幅随之出现），失败时抛错由调用方决定是否提示 */
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

  // 启动时静默检查一次：发现新版只让侧边栏横幅出现，不弹窗、不自动下载
  useEffect(() => {
    if (!enabled || autoCheckedRef.current) return;
    autoCheckedRef.current = true;
    void check().catch((error) => console.warn("自动检查更新失败：", updateFailureMessage(error)));
  }, [enabled, check]);

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

/** 侧边栏更新横幅（设置按钮上方）：hover / 点击弹出悬浮卡片（完整版本号 + 更新日志 + 立即升级）。
    横幅文案不带版本号，避免侧边栏宽度截断；无可用更新时不渲染。 */
export function UpdateNotice() {
  const { update, installing, install } = useAppUpdate();
  const feedback = useFeedback();
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  if (!update) return null;
  // 升级期间强制保持显示，避免 hover 移开后卡片消失、下载安装失去反馈
  const open = hovered || pinned || installing;
  // 打开更新日志后收起卡片，避免挡住侧边栏
  const openChangelog = () => {
    setPinned(false);
    setHovered(false);
    void api.openUrl(releaseNotesUrl).catch((error) => feedback.error(String(error)));
  };
  return (
    <div className="relative" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button type="button" className="update-notice-button" onClick={() => setPinned((value) => !value)}>
        <ArrowUpCircle strokeWidth={2} aria-hidden="true" />
        <span className="apple-sidebar-label">发现新版本</span>
      </button>
      {open ? (
        <div className="update-notice-popover">
          <div className="text-sm font-semibold">发现新版本 v{update.version}</div>
          <p className="muted meta-xs mt-1">下载并安装新版本，完成后自动重启</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" className="apple-action-button" onClick={openChangelog}>更新日志</button>
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
