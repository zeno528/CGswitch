import { lazy, Suspense, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Layers2, Minus, Blocks, Puzzle, CircleUserRound, Settings as SettingsIcon, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, isTauri } from "../api";
import { McpIcon } from "../components/McpIcon";
import { FeedbackProvider } from "./Feedback";
import { useActivationRefresh, useAppState, useCodexPolling, useSidebar, useThemeMode, type AppView } from "./appShellHooks";
import ProfilesView from "../features/profiles/ProfilesView";
import { AppUpdateProvider } from "../features/updates/AppUpdateProvider";
import { setupI18n } from "../i18n";

// 非默认页按访问加载：初始 chunk 只保留首页 ProfilesView，管理页首次进入时再拉对应 chunk
const McpView = lazy(() => import("../features/mcp/McpView"));
const PluginsView = lazy(() => import("../features/plugins/PluginsView"));
const SkillsView = lazy(() => import("../features/skills/SkillsView"));
const AccountsView = lazy(() => import("../features/accounts/AccountsView"));
const SettingsView = lazy(() => import("../features/settings/SettingsView"));

const appWindow = isTauri ? getCurrentWindow() : null;
// macOS 使用原生交通灯（titleBarStyle: Overlay），隐藏自绘窗口控制按钮并为交通灯预留空间
const isMacWindow = isTauri && /Macintosh/.test(navigator.userAgent);

// lazy 页面 chunk 加载期间的占位，结构复用 startup-skeleton
const pageFallback = (
  <div className="startup-skeleton" aria-busy="true">
    <div className="startup-skeleton__title" />
    <div className="startup-skeleton__subtitle" />
    <div className="startup-skeleton__panel" />
    <div className="startup-skeleton__heading" />
    <div className="startup-skeleton__list" />
  </div>
);

// 首屏之后空闲时后台预热 lazy chunk（与各 lazy() 指向同一 chunk，模块缓存幂等），
// 消除首次切页的骨架闪现；fire-and-forget，失败无感（进入页面时会重试）。
function preloadLazyViews() {
  void import("../features/mcp/McpView");
  void import("../features/plugins/PluginsView");
  void import("../features/skills/SkillsView");
  void import("../features/accounts/AccountsView");
  void import("../features/settings/SettingsView");
  void import("../features/profiles/ProfileEdit");
}

export default function AppShell() {
  const [view, setView] = useState<AppView>("profiles");
  const [profilesReset, setProfilesReset] = useState(0);
  const [mcpReset, setMcpReset] = useState(0);
  const [startupReady, setStartupReady] = useState(false);
  const { t } = useTranslation();
  const { state, stateRef, loadError, authStatusReady, refresh, refreshAuthStatus, updateAuthStatus, updateCodex, updateSettings, previewTheme } = useAppState();
  useThemeMode(state?.settings.theme);
  // 设置保存后（例如换了界面语言）即时切换，无需重启；托盘菜单文案一并同步。
  useEffect(() => {
    const language = setupI18n(state?.settings.language);
    if (isTauri) void api.setAppLanguage(language).catch(() => undefined);
  }, [state?.settings.language]);
  const { start: startPolling, stop: stopPolling } = useCodexPolling(stateRef, updateCodex);
  const { activationEpoch, activate, deactivate } = useActivationRefresh();
  const sidebar = useSidebar();

  useEffect(() => {
    let cancelled = false;
    let delayedAuth: number | undefined;
    void (async () => {
      await refresh();
      if (cancelled) return;
      // 语言必须在窗口显示前切好，否则用户会看到一帧系统语言。
      setupI18n(stateRef.current?.settings.language);
      if (isTauri && !stateRef.current?.settings.silent_start) {
        // 等首绘（双 rAF ≈ 一帧完成）再显示，窗口出现即完整内容；
        // 更新重启等热启动下加载极快，不等首绘会闪出空白窗口。
        // 隐藏窗口里 rAF 可能被节流，150ms 兜底保证窗口必定显示。
        await Promise.race([
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          new Promise((resolve) => window.setTimeout(resolve, 150)),
        ]);
        try {
          await appWindow?.show();
          await appWindow?.setFocus();
        } catch {
          // 内容初始化不依赖窗口显示成功。
        }
      }
      setStartupReady(true);
      delayedAuth = window.setTimeout(() => {
        if (!cancelled) void refreshAuthStatus();
      }, 0);
      startPolling();
    })();
    return () => {
      cancelled = true;
      if (delayedAuth !== undefined) window.clearTimeout(delayedAuth);
      stopPolling();
    };
  }, [refresh, refreshAuthStatus, startPolling, stopPolling]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | undefined;
    const onActive = () => {
      if (!activate()) return;
      void refresh();
      void refreshAuthStatus();
      startPolling();
    };
    const onInactive = () => {
      if (!deactivate()) return;
      stopPolling();
    };
    if (isTauri && appWindow) {
      void appWindow.onFocusChanged(({ payload: focused }) => {
        if (focused) {
          onActive();
          return;
        }
        // Windows 单 WebView 会把拖拽标题栏导致的 WebView 失焦合成为窗口失焦；
        // 仅当原生窗口也失焦时才停止轮询并允许下一次激活刷新。
        void appWindow.isFocused().then((windowFocused) => {
          if (!windowFocused) onInactive();
        });
      }).then((dispose) => {
        if (cancelled) dispose();
        else unlisten = dispose;
      });
      return () => {
        cancelled = true;
        unlisten?.();
      };
    }
    const onVisibility = () => (document.hidden ? onInactive() : onActive());
    window.addEventListener("focus", onActive);
    window.addEventListener("blur", onInactive);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onActive);
      window.removeEventListener("blur", onInactive);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activate, refresh, refreshAuthStatus, startPolling, stopPolling]);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const updateScrollbarSize = () => {
      document.documentElement.style.setProperty("--scrollbar-size", `${main.offsetWidth - main.clientWidth}px`);
    };
    updateScrollbarSize();
  }, []);

  // 预热不挤占首屏：等窗口显示（startupReady）后 idle 再拉 chunk，2s 兜底防饥饿
  useEffect(() => {
    if (!startupReady) return;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(preloadLazyViews, { timeout: 2000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = window.setTimeout(preloadLazyViews, 800);
    return () => window.clearTimeout(timer);
  }, [startupReady]);

  const goProfiles = () => {
    if (view === "profiles") return;
    setProfilesReset((value) => value + 1);
    setView("profiles");
  };

  const goMcp = () => {
    if (view === "mcp") return;
    setMcpReset((value) => value + 1);
    setView("mcp");
  };

  const goPlugins = () => {
    if (view === "plugins") return;
    setView("plugins");
  };

  const goSkills = () => {
    if (view === "skills") return;
    setView("skills");
  };

  const goSettings = () => {
    if (view === "settings") return;
    setView("settings");
  };

  const goAccounts = () => {
    if (view === "accounts") return;
    setView("accounts");
  };

  const navClass = "apple-sidebar-nav-button app-selection-state";

  return (
    <FeedbackProvider>
      {/* 首次窗口完成显示后才启动静默检查，避免更新链路进入首屏/冷启动关键路径。 */}
      <AppUpdateProvider enabled={Boolean(state?.settings.auto_check_update) && startupReady} ready={startupReady}>
      <div className={`flex h-full min-h-0 flex-col ${isMacWindow ? "is-mac" : ""}`}>
        <div className="apple-window-chrome">
          {isMacWindow ? <div className="apple-chrome-inset" data-tauri-drag-region aria-hidden="true" /> : null}
          <div data-tauri-drag-region className="min-w-0 flex-1 self-stretch" />
          {!isMacWindow ? (
            <div className="flex h-full items-center">
              <button type="button" className="window-control-button" aria-label={t("window.minimize")} onClick={() => void appWindow?.minimize()}><Minus strokeWidth={2} aria-hidden="true" /></button>
              <button type="button" className="window-control-button" aria-label={t("window.maximize")} onClick={() => void appWindow?.toggleMaximize()}><Square strokeWidth={2} aria-hidden="true" /></button>
              <button type="button" className="window-control-button window-control-button--close" aria-label={t("window.close")} onClick={() => void appWindow?.close()}><X strokeWidth={2} aria-hidden="true" /></button>
            </div>
          ) : null}
        </div>

        <div className="apple-workspace flex min-h-0 flex-1">
          <aside className={`apple-sidebar relative h-full shrink-0 ${sidebar.sidebarCollapsed ? "apple-sidebar--collapsed" : ""}`}>
            <div className="apple-sidebar-brand-row" data-tauri-drag-region>
              <div
                className="apple-sidebar-brand flex w-fit cursor-pointer items-center"
                role="button"
                tabIndex={0}
                aria-label="CGswitch"
                onClick={sidebar.toggleSidebar}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") sidebar.toggleSidebar();
                }}
                onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}
                onMouseLeave={() => sidebar.setSidebarFlyoutArmed(false)}
              >
                <img src="/logo.svg" alt="CGswitch" className="app-logo" draggable="false" />
                <span className="apple-sidebar-label apple-wordmark whitespace-nowrap">CGswitch</span>
              </div>
              {sidebar.sidebarFlyoutArmed ? (
                <span className="apple-sidebar-flyout" aria-hidden="true">{t(sidebar.sidebarCollapsed ? "sidebar.expand" : "sidebar.collapse")}</span>
              ) : null}
            </div>
            <nav className="mx-1.5 mt-3 space-y-1">
              <button type="button" className={navClass} data-active={view === "profiles" ? "true" : undefined} aria-label={t("nav.providers")} onClick={goProfiles} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}>
                <Layers2 strokeWidth={2} aria-hidden="true" />
                <span className="apple-sidebar-label" aria-hidden={sidebar.sidebarCollapsed}>{t("nav.providers")}</span>
                {sidebar.sidebarCollapsed && sidebar.sidebarFlyoutArmed ? <span className="apple-sidebar-flyout" aria-hidden="true">{t("nav.providers")}</span> : null}
              </button>
              <button type="button" className={navClass} data-active={view === "mcp" ? "true" : undefined} aria-label={t("nav.mcp")} onClick={goMcp} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}>
                <McpIcon className="h-[18px] w-[18px]" />
                <span className="apple-sidebar-label" aria-hidden={sidebar.sidebarCollapsed}>{t("nav.mcp")}</span>
                {sidebar.sidebarCollapsed && sidebar.sidebarFlyoutArmed ? <span className="apple-sidebar-flyout" aria-hidden="true">{t("nav.mcp")}</span> : null}
              </button>
              <button type="button" className={navClass} data-active={view === "plugins" ? "true" : undefined} aria-label={t("nav.plugins")} onClick={goPlugins} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}>
                <Blocks strokeWidth={2} aria-hidden="true" />
                <span className="apple-sidebar-label" aria-hidden={sidebar.sidebarCollapsed}>{t("nav.plugins")}</span>
                {sidebar.sidebarCollapsed && sidebar.sidebarFlyoutArmed ? <span className="apple-sidebar-flyout" aria-hidden="true">{t("nav.plugins")}</span> : null}
              </button>
              <button type="button" className={navClass} data-active={view === "skills" ? "true" : undefined} aria-label={t("nav.skills")} onClick={goSkills} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}>
                <Puzzle strokeWidth={2} aria-hidden="true" />
                <span className="apple-sidebar-label" aria-hidden={sidebar.sidebarCollapsed}>{t("nav.skills")}</span>
                {sidebar.sidebarCollapsed && sidebar.sidebarFlyoutArmed ? <span className="apple-sidebar-flyout" aria-hidden="true">{t("nav.skills")}</span> : null}
              </button>
            </nav>
            <div className="absolute inset-x-1.5 bottom-4 flex flex-col gap-1.5">
              <button type="button" className={navClass} data-active={view === "accounts" ? "true" : undefined} aria-label={t("nav.accounts")} onClick={goAccounts} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}>
                <CircleUserRound strokeWidth={2} aria-hidden="true" />
                <span className="apple-sidebar-label" aria-hidden={sidebar.sidebarCollapsed}>{t("nav.accounts")}</span>
                {sidebar.sidebarCollapsed && sidebar.sidebarFlyoutArmed ? <span className="apple-sidebar-flyout" aria-hidden="true">{t("nav.accounts")}</span> : null}
              </button>
              <button type="button" className={navClass} data-active={view === "settings" ? "true" : undefined} aria-label={t("nav.settings")} onClick={() => goSettings()} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}>
                <SettingsIcon strokeWidth={2} aria-hidden="true" />
                <span className="apple-sidebar-label" aria-hidden={sidebar.sidebarCollapsed}>{t("nav.settings")}</span>
                {sidebar.sidebarCollapsed && sidebar.sidebarFlyoutArmed ? <span className="apple-sidebar-flyout" aria-hidden="true">{t("nav.settings")}</span> : null}
              </button>
            </div>
          </aside>

          <main className="apple-main-card min-w-0 flex-1 overflow-y-auto overflow-x-hidden pt-4">
            <div key={state ? view : "loading"} className="apple-page-enter">
              {!state ? (
                <div className="startup-skeleton" aria-busy="true">
                  <div className="startup-skeleton__title" />
                  <div className="startup-skeleton__subtitle" />
                  <div className="startup-skeleton__panel" />
                  <div className="startup-skeleton__heading" />
                  <div className="startup-skeleton__list" />
                  {loadError ? <p className="muted mt-4 text-sm">{loadError}</p> : null}
                </div>
              ) : (
                <Suspense fallback={pageFallback}>
                  {view === "profiles" ? (
                    <ProfilesView key={profilesReset} state={state} authStatusReady={authStatusReady} activationEpoch={activationEpoch} onRefresh={refresh} onManageChatgptAccounts={goAccounts} />
                  ) : view === "mcp" ? (
                    <McpView key={mcpReset} />
                  ) : view === "plugins" ? (
                    <PluginsView state={state} />
                  ) : view === "skills" ? (
                    <SkillsView activationEpoch={activationEpoch} />
                  ) : view === "accounts" ? (
                    <AccountsView initialStatus={state.auth_status} balanceCache={state.balance_cache} onAuthStatusChange={updateAuthStatus} />
                  ) : (
                    <SettingsView state={state} onPreviewTheme={previewTheme} onRefresh={refresh} onSaved={updateSettings} onHome={goProfiles} />
                  )}
                </Suspense>
              )}
            </div>
          </main>
        </div>
      </div>
      </AppUpdateProvider>
    </FeedbackProvider>
  );
}
