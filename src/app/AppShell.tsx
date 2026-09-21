import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Layers2, Minus, Blocks, Puzzle, CircleUserRound, Settings as SettingsIcon, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, isTauri } from "../api";
import { McpIcon } from "../components/McpIcon";
import { FeedbackProvider } from "./Feedback";
import { getMcpDiffBadge, setMcpDiffBadge, subscribeMcpDiffBadge } from "./managementDataCache";
import { useActivationRefresh, useAppState, useCodexPolling, useSidebar, useThemeMode, type AppView } from "./appShellHooks";
import ProfilesView from "../features/profiles/ProfilesView";
import McpView from "../features/mcp/McpView";
import PluginsView from "../features/plugins/PluginsView";
import SkillsView from "../features/skills/SkillsView";
import AccountsView from "../features/accounts/AccountsView";
import SettingsView from "../features/settings/SettingsView";
import { AppUpdateProvider } from "../features/updates/AppUpdateProvider";
import { setupI18n } from "../i18n";

const appWindow = isTauri ? getCurrentWindow() : null;
// macOS 使用原生交通灯（titleBarStyle: Overlay），隐藏自绘窗口控制按钮并为交通灯预留空间
const isMacWindow = isTauri && /Macintosh/.test(navigator.userAgent);

export default function AppShell() {
  const [view, setView] = useState<AppView>("profiles");
  const [profilesReset, setProfilesReset] = useState(0);
  const [mcpReset, setMcpReset] = useState(0);
  const [startupReady, setStartupReady] = useState(false);
  const { t } = useTranslation();
  // 侧栏角标复用 MCP 页的差异计数文案，避免同一件事在两处各写一份
  const { t: tMcp } = useTranslation("mcp");
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
  // 侧栏 MCP 角标：首屏只读缓存直出（同步读 localStorage，与 sidebar-collapsed 同级），
  // 真正查一次差异放到 startupReady 之后延迟执行，不进首屏与冷启动关键路径。
  const mcpDiffBadge = useSyncExternalStore(subscribeMcpDiffBadge, getMcpDiffBadge);
  // 有可逐条处理的差异显示数字；配置解析不了显示 "!"（与 MCP 页头按钮同款语义）
  const mcpBadge = mcpDiffBadge?.count ? (mcpDiffBadge.count > 9 ? "9+" : String(mcpDiffBadge.count)) : mcpDiffBadge?.error ? "!" : null;
  const mcpBadgeTitle = mcpDiffBadge?.count
    ? tMcp("list.updateDiffAria", { count: mcpDiffBadge.count })
    : mcpDiffBadge?.error ? tMcp("list.diffUnavailable") : undefined;

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

  // 首屏稳定后再静默查一次 MCP 差异（实测单次 0.5ms 级，但绝不与首帧抢资源）。
  // 失败不静默：写回 error 态让侧栏角标亮起——config.toml 解析失败是"不点进 MCP 页
  // 就发现不了"的状况，正是这个角标存在的意义（MCP 页自己也会看到同一条状态）。
  useEffect(() => {
    if (!startupReady) return;
    const timer = window.setTimeout(() => {
      void api.mcpSyncPreview()
        .then((preview) => setMcpDiffBadge({ count: preview.entries.length, error: false }))
        .catch(() => setMcpDiffBadge({ count: 0, error: true }));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [startupReady]);

  useEffect(() => {
    const main = document.querySelector("main");
    if (!main) return;
    const updateScrollbarSize = () => {
      document.documentElement.style.setProperty("--scrollbar-size", `${main.offsetWidth - main.clientWidth}px`);
    };
    updateScrollbarSize();
  }, []);

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
              <button type="button" className={navClass} data-active={view === "mcp" ? "true" : undefined} aria-label={t("nav.mcp")} title={mcpBadgeTitle} onClick={goMcp} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}>
                {/* 角标锚在图标上：收缩态只剩图标时位置依然正确，且 --sidebar-bg 与 --panel-bg 同色，角标描边不用另配 */}
                <span className="relative flex shrink-0">
                  <McpIcon className="h-[18px] w-[18px]" />
                  {mcpBadge ? <span className="apple-count-badge" aria-hidden="true">{mcpBadge}</span> : null}
                </span>
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
              ) : view === "profiles" ? (
                <ProfilesView key={profilesReset} state={state} authStatusReady={authStatusReady} activationEpoch={activationEpoch} onRefresh={refresh} onManageChatgptAccounts={goAccounts} />
              ) : view === "mcp" ? (
                <McpView key={mcpReset} activationEpoch={activationEpoch} />
              ) : view === "plugins" ? (
                <PluginsView state={state} />
              ) : view === "skills" ? (
                <SkillsView activationEpoch={activationEpoch} />
              ) : view === "accounts" ? (
                <AccountsView initialStatus={state.auth_status} balanceCache={state.balance_cache} onAuthStatusChange={updateAuthStatus} />
              ) : (
                <SettingsView state={state} onPreviewTheme={previewTheme} onRefresh={refresh} onSaved={updateSettings} onHome={goProfiles} />
              )}
            </div>
          </main>
        </div>
      </div>
      </AppUpdateProvider>
    </FeedbackProvider>
  );
}
