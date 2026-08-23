import { useEffect, useState } from "react";
import { Layers2, Minus, Blocks, Puzzle, Settings as SettingsIcon, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../api";
import { McpIcon } from "../components/McpIcon";
import { FeedbackProvider } from "./Feedback";
import { useActivationRefresh, useAppState, useCodexPolling, useSidebarIndicator, useThemeMode, type AppView } from "./appShellHooks";
import { loadPlugins, loadSkills } from "./managementDataCache";
import ProfilesView from "../features/profiles/ProfilesView";
import McpView from "../features/mcp/McpView";
import PluginsView from "../features/plugins/PluginsView";
import SkillsView from "../features/skills/SkillsView";
import SettingsView from "../features/settings/SettingsView";
import type { SkillSummary } from "../types";

const appWindow = isTauri ? getCurrentWindow() : null;

export default function AppShell() {
  const [view, setView] = useState<AppView>("profiles");
  const [profilesReset, setProfilesReset] = useState(0);
  const [mcpReset, setMcpReset] = useState(0);
  const [skillCache, setSkillCache] = useState<SkillSummary[] | null>(null);
  const { state, stateRef, loadError, refresh, refreshAuthStatus, updateCodex, updateSettings, previewTheme } = useAppState();
  useThemeMode(state?.settings.theme);
  const { start: startPolling, stop: stopPolling } = useCodexPolling(stateRef, updateCodex);
  const { activationEpoch, activate } = useActivationRefresh();
  const sidebar = useSidebarIndicator(view);

  useEffect(() => {
    let cancelled = false;
    let delayedAuth: number | undefined;
    void (async () => {
      await refresh();
      if (cancelled) return;
      if (isTauri && !stateRef.current?.settings.silent_start) {
        try {
          await appWindow?.show();
        } catch {
          // 内容初始化不依赖窗口显示成功。
        }
      }
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

  const appReady = state !== null;
  useEffect(() => {
    if (!appReady) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void loadSkills()
        .then((items) => {
          if (!cancelled) setSkillCache(items);
        })
        .catch(() => undefined);
      void loadPlugins().catch(() => undefined);
    }, 1200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [appReady]);

  useEffect(() => {
    const onActive = () => {
      activate();
      void refresh();
      void refreshAuthStatus();
      startPolling();
    };
    const onInactive = () => stopPolling();
    const onVisibility = () => (document.hidden ? onInactive() : onActive());
    window.addEventListener("focus", onActive);
    window.addEventListener("blur", onInactive);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
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
    const observer = new ResizeObserver(updateScrollbarSize);
    observer.observe(main);
    return () => observer.disconnect();
  }, []);

  const goProfiles = () => {
    setProfilesReset((value) => value + 1);
    setView("profiles");
  };

  const goMcp = () => {
    setMcpReset((value) => value + 1);
    setView("mcp");
  };

  const goPlugins = () => {
    setView("plugins");
  };

  const goSkills = () => {
    setView("skills");
  };

  const navClass = (active: boolean) =>
    `apple-sidebar-nav-button ${active ? "bg-[var(--selection-bg)] font-semibold text-accent" : "font-normal hover:bg-black/5 dark:hover:bg-white/8"}`;

  return (
    <FeedbackProvider>
      <div className="flex h-full min-h-0 flex-col">
        <div className="apple-window-chrome">
          <div
            data-tauri-drag-region
            className={`apple-sidebar-shell ${sidebar.sidebarCollapsed ? "apple-sidebar--collapsed" : ""}`}
          >
            <div
              className="apple-sidebar-brand flex h-full w-fit cursor-pointer items-center"
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
              <img src="/logo.svg" alt="CGswitch" className="dark:invert" draggable="false" />
              <span className="apple-sidebar-label apple-wordmark whitespace-nowrap">CGswitch</span>
            </div>
            {sidebar.sidebarFlyoutArmed ? (
              <span className="apple-sidebar-flyout" aria-hidden="true">{sidebar.sidebarCollapsed ? "展开侧边栏" : "收缩侧边栏"}</span>
            ) : null}
          </div>
          <div data-tauri-drag-region className="min-w-0 flex-1 self-stretch" />
          <div className="flex h-full items-center">
            <button type="button" className="window-control-button" aria-label="最小化" onClick={() => void appWindow?.minimize()}><Minus strokeWidth={2} aria-hidden="true" /></button>
            <button type="button" className="window-control-button" aria-label="最大化" onClick={() => void appWindow?.toggleMaximize()}><Square strokeWidth={2} aria-hidden="true" /></button>
            <button type="button" className="window-control-button window-control-button--close" aria-label="关闭" onClick={() => void appWindow?.close()}><X strokeWidth={2} aria-hidden="true" /></button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className={`apple-sidebar relative h-full shrink-0 ${sidebar.sidebarCollapsed ? "apple-sidebar--collapsed" : ""}`}>
            <nav ref={sidebar.sidebarNavRef} className="relative mx-1.5 mt-3 space-y-1">
              <span className={`apple-sidebar-indicator ${sidebar.indicator.instant ? "apple-sidebar-indicator--instant" : ""}`} style={{ top: `${sidebar.indicator.top}px`, left: `${sidebar.indicator.left}px` }} aria-hidden="true" />
              <button ref={sidebar.profileNavRef} type="button" className={navClass(view === "profiles")} aria-label="供应商配置" onClick={goProfiles} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}>
                <Layers2 strokeWidth={2} aria-hidden="true" />
                <span className="apple-sidebar-label" aria-hidden={sidebar.sidebarCollapsed}>供应商配置</span>
                {sidebar.sidebarCollapsed && sidebar.sidebarFlyoutArmed ? <span className="apple-sidebar-flyout" aria-hidden="true">供应商配置</span> : null}
              </button>
              <button ref={sidebar.mcpNavRef} type="button" className={navClass(view === "mcp")} aria-label="MCP 管理" onClick={goMcp} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}>
                <McpIcon className="h-[18px] w-[18px]" />
                <span className="apple-sidebar-label" aria-hidden={sidebar.sidebarCollapsed}>MCP 管理</span>
                {sidebar.sidebarCollapsed && sidebar.sidebarFlyoutArmed ? <span className="apple-sidebar-flyout" aria-hidden="true">MCP 管理</span> : null}
              </button>
              <button ref={sidebar.pluginsNavRef} type="button" className={navClass(view === "plugins")} aria-label="插件" onClick={goPlugins} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}>
                <Blocks strokeWidth={2} aria-hidden="true" />
                <span className="apple-sidebar-label" aria-hidden={sidebar.sidebarCollapsed}>插件</span>
                {sidebar.sidebarCollapsed && sidebar.sidebarFlyoutArmed ? <span className="apple-sidebar-flyout" aria-hidden="true">插件</span> : null}
              </button>
              <button ref={sidebar.skillsNavRef} type="button" className={navClass(view === "skills")} aria-label="Skill" onClick={goSkills} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}>
                <Puzzle strokeWidth={2} aria-hidden="true" />
                <span className="apple-sidebar-label" aria-hidden={sidebar.sidebarCollapsed}>Skill</span>
                {sidebar.sidebarCollapsed && sidebar.sidebarFlyoutArmed ? <span className="apple-sidebar-flyout" aria-hidden="true">Skill</span> : null}
              </button>
            </nav>
            <div className="absolute inset-x-1.5 bottom-4">
              <button ref={sidebar.settingsNavRef} type="button" className={navClass(view === "settings")} aria-label="设置" onClick={() => setView("settings")} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}>
                <SettingsIcon strokeWidth={2} aria-hidden="true" />
                <span className="apple-sidebar-label" aria-hidden={sidebar.sidebarCollapsed}>设置</span>
                {sidebar.sidebarCollapsed && sidebar.sidebarFlyoutArmed ? <span className="apple-sidebar-flyout" aria-hidden="true">设置</span> : null}
              </button>
            </div>
          </aside>

          <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-[var(--app-bg)] pt-4">
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
              <ProfilesView key={profilesReset} state={state} activationEpoch={activationEpoch} onRefresh={refresh} />
            ) : view === "mcp" ? (
              <McpView key={mcpReset} />
            ) : view === "plugins" ? (
              <PluginsView />
            ) : view === "skills" ? (
              <SkillsView cachedSkills={skillCache} onSkillsChange={setSkillCache} />
            ) : (
              <SettingsView state={state} onPreviewTheme={previewTheme} onRefresh={refresh} onSaved={updateSettings} onHome={goProfiles} />
            )}
          </main>
        </div>
      </div>
    </FeedbackProvider>
  );
}
