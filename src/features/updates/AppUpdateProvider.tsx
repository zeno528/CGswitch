import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Download } from "lucide-react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { checkForAppUpdate, UPDATED_VERSION_KEY, type AppUpdate } from "./appUpdate";
import { updateFailureMessage } from "./updateText";
import { UpdateNotesDialog } from "./UpdateNotesDialog";

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
  if (!value) throw new Error("useAppUpdate 必须在 AppUpdateProvider 内使用"); // i18n-exempt: 开发者契约错误，用户不可见
  return value;
}

export function AppUpdateProvider({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const feedback = useFeedback();
  const { t } = useTranslation("updates");
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
    void check().catch((error) => console.warn("自动检查更新失败：", updateFailureMessage(error, t))); // i18n-exempt: 仅写控制台，用户不可见
  }, [enabled, check, t]);

  // 应用内更新重启回来：读到安装时留下的版本标记即弹「更新成功」通知（与 enabled 无关，标记只会在更新后存在一次）。
  // 标记由后端原子落盘（Windows 安装器会立即杀进程，localStorage 异步提交可能丢）；
  // 旧版本写在 localStorage 的键也兜底消费一次，覆盖升级过渡期
  useEffect(() => {
    void (async () => {
      const legacy = localStorage.getItem(UPDATED_VERSION_KEY);
      if (legacy) localStorage.removeItem(UPDATED_VERSION_KEY);
      const updatedVersion = legacy ?? (await api.takeUpdateMarker().catch(() => null));
      if (!updatedVersion) return;
      feedback.success(t("toast.updated", { version: updatedVersion }));
    })();
  }, [feedback, t]);

  const install = useCallback(async () => {
    if (!update || installing) return;
    setInstalling(true);
    try {
      await update.install();
    } catch (error) {
      feedback.error(updateFailureMessage(error, t));
    } finally {
      setInstalling(false);
    }
  }, [update, installing, feedback, t]);

  return <AppUpdateContext.Provider value={{ update, checking, installing, check, install }}>{children}</AppUpdateContext.Provider>;
}

/** 状态栏更新图标：点击直接打开更新日志确认弹窗（先看日志，确认后才安装）。 */
export function UpdateNotice() {
  const { update } = useAppUpdate();
  const { t } = useTranslation("updates");
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!update) setConfirming(false);
  }, [update]);
  if (!update) return null;
  return (
    <div className="update-notice">
      <button
        type="button"
        className="update-notice-trigger"
        aria-label={t("notice.title", { version: update.version })}
        aria-expanded={confirming}
        aria-haspopup="dialog"
        onClick={() => setConfirming(true)}
      >
        <span className="update-notice-trigger__icon grid h-6 w-6 place-items-center rounded-full bg-success text-[var(--active-card-text-primary)]">
          <Download className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
        </span>
        <span className="field-label update-notice-label">{t("notice.available")}</span>
      </button>
      <UpdateNotesDialog open={confirming} onOpenChange={setConfirming} />
    </div>
  );
}
