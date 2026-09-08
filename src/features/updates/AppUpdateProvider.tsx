import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, LoaderCircle, X } from "lucide-react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { checkForAppUpdate, UPDATED_VERSION_KEY, type AppUpdate } from "./appUpdate";
import { updateFailureMessage } from "./updateText";

/** 更新日志入口：GitHub 最新 Release 页 */
export const releaseNotesUrl = "https://github.com/zeno528/CGswitch/releases/latest";
type UpdateSource = "sidebar" | "about";

interface AppUpdateContextValue {
  /** 已发现的可用更新；null 表示已是最新或尚未检查 */
  update: AppUpdate | null;
  updateSource: UpdateSource | null;
  checking: boolean;
  installing: boolean;
  /** 检查更新：结果写入 context（横幅随之出现），失败时抛错由调用方决定是否提示 */
  check: (source: UpdateSource) => Promise<AppUpdate | null>;
  /** 用户点击升级后才执行：下载安装并重启 */
  install: (source: UpdateSource) => Promise<void>;
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
  const [updateSource, setUpdateSource] = useState<UpdateSource | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  // StrictMode 下 effect 双跑共用同一组件实例，state 守卫两次都读到旧值，必须用 ref 防重入
  const autoCheckedRef = useRef(false);
  const checkingRef = useRef(false);

  const check = useCallback(async (source: UpdateSource): Promise<AppUpdate | null> => {
    if (checkingRef.current) return update;
    checkingRef.current = true;
    setChecking(true);
    try {
      const found = await checkForAppUpdate();
      setUpdate(found);
      setUpdateSource(found ? source : null);
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
    void check("sidebar").catch((error) => console.warn("自动检查更新失败：", updateFailureMessage(error)));
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

  const install = useCallback(async (source: UpdateSource) => {
    if (!update || installing) return;
    setUpdateSource(source);
    setInstalling(true);
    try {
      await update.install();
    } catch (error) {
      feedback.error(updateFailureMessage(error));
    } finally {
      setInstalling(false);
    }
  }, [update, installing, feedback]);

  return <AppUpdateContext.Provider value={{ update, updateSource, checking, installing, check, install }}>{children}</AppUpdateContext.Provider>;
}

/** 侧边栏更新横幅（设置按钮上方）：hover / 点击弹出悬浮卡片（完整版本号 + 更新日志 + 立即升级）。
    横幅文案不带版本号，避免侧边栏宽度截断；有可用更新即渲染（无论从哪个入口发现）。
    升级中状态跟随发起入口：仅侧边栏发起时强制展开悬浮卡片，设置页发起时卡片不自动弹。 */
export function UpdateNotice() {
  const { update, updateSource, installing, install } = useAppUpdate();
  const feedback = useFeedback();
  const [autoOpened, setAutoOpened] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const noticeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (update && updateSource === "sidebar") setAutoOpened(true);
  }, [update, updateSource]);
  useEffect(() => {
    if (!pinned) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (noticeRef.current?.contains(event.target as Node)) return;
      setPinned(false);
      setHovered(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [pinned]);
  if (!update) return null;
  // 升级由哪个入口发起，进度就归哪个入口：install() 已把 updateSource 改写为发起方，
  // 侧边栏发起时卡片强制保持展开（避免 hover 移开丢反馈）；设置页发起时这边不弹卡
  const installingHere = installing && updateSource === "sidebar";
  const open = autoOpened || hovered || pinned || installingHere;
  const closePopover = () => {
    setAutoOpened(false);
    setPinned(false);
    setHovered(false);
  };
  // 打开更新日志后收起卡片，避免挡住侧边栏
  const openChangelog = () => {
    closePopover();
    void api.openUrl(releaseNotesUrl).catch((error) => feedback.error(String(error)));
  };
  return (
    <div ref={noticeRef} className="relative" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <button type="button" className="update-notice-button" onClick={() => setPinned((value) => !value)}>
        <span className="grid h-[var(--sidebar-icon-size)] w-[var(--sidebar-icon-size)] shrink-0 place-items-center rounded-full bg-success text-[var(--panel-bg)]">
          <ArrowUp className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
        </span>
        <span className="apple-sidebar-label">发现新版本</span>
      </button>
      {open ? (
        <div className="update-notice-popover">
          <button type="button" className="absolute right-2 top-2 grid h-5 w-5 place-items-center rounded-full text-[var(--text-secondary)] hover:bg-(--profile-chip-bg) hover:text-[var(--text-primary)]" aria-label="关闭更新提示" onClick={closePopover}>
            <X className="h-3 w-3" strokeWidth={2.5} aria-hidden="true" />
          </button>
          <div className="pr-7 text-sm font-semibold">发现新版本 v{update.version}</div>
          <p className="muted meta-xs mt-1">下载并安装新版本，完成后自动重启</p>
          <div className="mt-2.5 flex flex-nowrap gap-2">
            <button type="button" className="apple-action-button" onClick={openChangelog}>更新日志</button>
            <button type="button" className="apple-action-button app-button--primary" disabled={installing} onClick={() => void install("sidebar")}>
              {installing ? <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" /> : null}
              {installing ? "下载安装中…" : "立即升级"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
