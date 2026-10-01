import { Activity, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type MutableRefObject, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Layers2, Minus, Blocks, Puzzle, CircleUserRound, Settings as SettingsIcon, Square, X } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { api, isTauri } from "../api";
import { McpIcon } from "../components/McpIcon";
import { FeedbackProvider, useFeedback } from "./Feedback";
import { authQuotaErrorKind } from "./authQuotaCache";
import { getMcpDiffBadge, loadClaudeMcpServers, loadClaudeProfiles, loadMcpServers, loadPluginMarketplaces, loadPlugins, loadSkills, mcpDiffBadgeText, setMcpDiffBadge, subscribeMcpDiffBadge } from "./managementDataCache";
import { useActivationRefresh, useAppState, useCodexPolling, useSidebar, useThemeMode, type AppView } from "./appShellHooks";
import ProfilesView from "../features/profiles/ProfilesView";
import McpView from "../features/mcp/McpView";
import PluginsView from "../features/plugins/PluginsView";
import SkillsView from "../features/skills/SkillsView";
import ClaudeProfilesView from "../features/claude/ClaudeProfilesView";
import AccountsView from "../features/accounts/AccountsView";
import SettingsView from "../features/settings/SettingsView";
import { AppUpdateProvider, UpdateNotice } from "../features/updates/AppUpdateProvider";
import { setupI18n, type resources } from "../i18n";
import type { AppState } from "../types";
import { switchProfileFromTray } from "./traySwitch";

const appWindow = isTauri ? getCurrentWindow() : null;
// macOS 使用原生交通灯（titleBarStyle: Overlay），隐藏自绘窗口控制按钮并为交通灯预留空间
const isMacWindow = isTauri && /Macintosh/.test(navigator.userAgent);

/// 差异检查：读 config.toml 跟数据库镜像比，把结果写进侧栏角标。
/// 启动后延迟一次、窗口激活时一次，两处共用这一条规则——放在模块作用域是为了
/// 引用稳定，激活那条 effect 不需要把它挂进依赖数组。
/// 失败不静默：写回 error 态，让"config.toml 坏了"在切回窗口那一刻就可见，
/// 而不是等用户点进 MCP 页才发现。
const checkMcpDiff = () =>
  api.mcpSyncPreview()
    .then((preview) => setMcpDiffBadge({ count: preview.entries.length, error: false }))
    .catch(() => setMcpDiffBadge({ count: 0, error: true }));

// 进场动画的作用范围沿用原 CSS 动画的选择器：任何新挂载的页内容元素都整段上浮。
const PAGE_ENTER_TARGET =
  ".apple-page-enter > :is(.apple-scroll-page, .apple-edit-page, .settings-page) > .apple-edit-content";

/// 侧栏条目/分组标题的文案 key：直接从 common/nav 资源推导，新增导航项自动跟随。
type SidebarLabelKey = `nav.${keyof (typeof resources)["zh-CN"]["common"]["nav"]}`;

/// 页面进场动画：沿原 cubic-bezier(0.16,1,0.35,1) 曲线做 8px 上浮，但位移逐帧量化到整设备像素。
/// Chromium 渲染合成变换时本就按整设备像素取样：曲线尾段的亚像素爬行不会产生更细腻的运动，
/// 只会让文字在减速段反复发虚（DPR 1.5 的 4K 屏最明显），归零瞬间还会留一次亚像素跳变。
/// 这里按曲线穿过每个整设备像素边界的时刻生成步进关键帧：每帧文字都锐利，末段整像素自然
/// 减速落零、最后一步与其他步等大，且动画随之结束——原 700ms 里可见运动本就止于 ~330ms。
function animatePageEnter(el: Element) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const dpr = window.devicePixelRatio || 1;
  // cubic-bezier(0.16,1,0.35,1)：两控制点纵坐标均为 1，故 y(t)=3t(1-t)+t³；x(t) 按横坐标控制点求值
  const yAt = (t: number) => 3 * t * (1 - t) + t * t * t;
  const xAt = (t: number) => 3 * (1 - t) * (1 - t) * t * 0.16 + 3 * (1 - t) * t * t * 0.35 + t * t * t;
  const tForY = (y: number) => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 32; i++) {
      const mid = (lo + hi) / 2;
      if (yAt(mid) < y) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  const steps = Math.max(1, Math.round(8 * dpr));
  // times[i] = 渲染偏移从 (steps-i) 跌到 (steps-i-1) 个设备像素的时刻
  const times: number[] = [];
  for (let k = steps; k >= 1; k--) {
    times.push(xAt(tForY(1 - (k - 0.5) / (8 * dpr))) * 700);
  }
  const total = times[times.length - 1];
  const frames = times.map((_, i) => ({
    transform: `translateY(${(steps - i) / dpr}px)`,
    offset: i === 0 ? 0 : times[i - 1] / total,
    easing: "steps(1, end)",
  }));
  frames.push({ transform: "translateY(0px)", offset: 1, easing: "linear" });
  el.animate(frames, { duration: Math.round(total) });
}

/// 与原 CSS 动画语义一致：每次进入页面（首次挂载、切页、切回保活页）页内容上浮一次，
/// 各页内部重挂载出现的新页内容也播放。effect 以 view 为依赖：切回已保活的页面时 DOM
/// 不变、MutationObserver 收不到，靠重跑 scan 补播；observer 只负责同页内部的新挂载，
/// played 随 effect 重建，因此同一次停留内同一元素不会重复播。保活页隐藏后仍在 DOM 里
/// （display:none），scan 按 offsetParent 跳过，不给看不见的页面播动画。
function usePageEnterAnimation(mainRef: { current: HTMLElement | null }, view: AppView) {
  useLayoutEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const played = new WeakSet<Element>();
    const scan = () => {
      for (const el of main.querySelectorAll(PAGE_ENTER_TARGET)) {
        if ((el as HTMLElement).offsetParent === null || played.has(el)) continue;
        played.add(el);
        animatePageEnter(el);
      }
    };
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [mainRef, view]);
}

function TrayActions({ stateRef, refresh, openSettings, openAccounts }: {
  stateRef: MutableRefObject<AppState | null>;
  refresh: () => Promise<void>;
  openSettings: () => void;
  openAccounts: () => void;
}) {
  const feedback = useFeedback();
  const { t } = useTranslation("profiles");
  const latest = useRef({ feedback, t, refresh, openSettings, openAccounts });
  latest.current = { feedback, t, refresh, openSettings, openAccounts };
  const busy = useRef(false);

  useEffect(() => {
    if (!isTauri) return;
    let disposed = false;
    const showError = async (message: string) => {
      try {
        await appWindow?.show();
        await appWindow?.unminimize();
        await appWindow?.setFocus();
      } catch {
        // 窗口恢复失败时仍保留前端错误提示。
      }
      latest.current.feedback.error(message);
    };
    void Promise.allSettled([
      listen("tray-open-settings", () => latest.current.openSettings()),
      listen("tray-open-accounts", () => latest.current.openAccounts()),
      listen<string>("tray-switch-profile", async ({ payload: id }) => {
        const state = stateRef.current;
        if (busy.current) return;
        if (!state?.profiles.some((profile) => profile.id === id) || state.active_profile_id === id) {
          await latest.current.refresh();
          return;
        }
        busy.current = true;
        const { feedback, t, refresh } = latest.current;
        try {
          const result = await switchProfileFromTray(id, state, refresh);
          feedback.success(t(`feedback.${result}`));
        } catch (error) {
          const message = String(error);
          await refresh();
          await showError(authQuotaErrorKind(message) === "auth_expired" ? t("balance.authInvalidToast") : message);
        } finally {
          busy.current = false;
        }
      }),
    ]).then((results) => {
      const unlisten = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
      if (disposed) unlisten.forEach((dispose) => dispose());
      else cleanup = () => unlisten.forEach((dispose) => dispose());
    });
    let cleanup = () => {};
    return () => { disposed = true; cleanup(); };
  }, [stateRef]);
  return null;
}

export default function AppShell() {
  const [view, setView] = useState<AppView>("profiles");
  // 切页记忆：进过的页面保活（Activity hidden），未访问页连渲染都不发生，冷启动零新增。
  const [visitedViews, setVisitedViews] = useState<ReadonlySet<AppView>>(() => new Set<AppView>(["profiles"]));
  const [startupReady, setStartupReady] = useState(false);
  const { t } = useTranslation();
  // 侧栏角标复用 MCP 页的差异计数文案，避免同一件事在两处各写一份
  const { t: tMcp } = useTranslation("mcp");
  const { state, stateRef, loadError, authStatusReady, refresh, refreshAuthStatus, updateAuthStatus, updateCodex, updateSettings, previewTheme } = useAppState();
  useThemeMode(state?.settings.theme);
  // 设置保存后即时切换语言；托盘沿用已加载的状态，不增加原生冷启动读取。
  useEffect(() => {
    const language = setupI18n(state?.settings.language);
    if (isTauri && state) {
      void api.setTrayMenu(language, state.profiles.map(({ id, name }) => ({ id, name })), state.active_profile_id).catch(() => undefined);
    }
  }, [state?.settings.language, state?.profiles, state?.active_profile_id]);
  const { start: startPolling, stop: stopPolling } = useCodexPolling(stateRef, updateCodex);
  const { activationEpoch, activate, deactivate } = useActivationRefresh();
  const sidebar = useSidebar();
  // 页面进场动画：挂在 <main> 上监听页内容挂载，切回保活页时补播（见 usePageEnterAnimation）
  const mainRef = useRef<HTMLElement>(null);
  usePageEnterAnimation(mainRef, view);
  // 首次进入的页面在渲染期就补进挂载清单（React 丢弃中间渲染、不提交空帧）。
  // 若放到 useEffect 里，切页第一帧是「旧页已隐藏、新页未挂载」的空白主区域——
  // 浏览器先画出这个空帧再补挂载，正是首次进入各页闪一下的来源；
  // 第二次进入已在清单内，单次渲染直接显隐切换，所以不闪。
  if (!visitedViews.has(view)) {
    setVisitedViews(new Set(visitedViews).add(view));
  }
  // 侧栏 MCP 角标：首屏只读缓存直出（同步读 localStorage，与 sidebar-collapsed 同级），
  // 真正查一次差异放到 startupReady 之后延迟执行，不进首屏与冷启动关键路径。
  const mcpDiffBadge = useSyncExternalStore(subscribeMcpDiffBadge, getMcpDiffBadge);
  // 角标文本与 MCP 页头同源：规则住在 managementDataCache，不在两处各写一遍
  const mcpBadge = mcpDiffBadgeText(mcpDiffBadge);
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
      // 首屏数据就绪里程碑：performance.now() 以文档导航起点为 0，与 native 埋点同一时间线对照
      if (isTauri) void api.reportStartupMark("state_ready", Math.round(performance.now())).catch(() => undefined);
      if (isTauri && !stateRef.current?.settings.silent_start) {
        // 等首绘（双 rAF ≈ 一帧完成）再显示，窗口出现即完整内容；
        // 更新重启等热启动下加载极快，不等首绘会闪出空白窗口。
        // 隐藏窗口里 rAF 可能被节流，150ms 兜底保证窗口必定显示。
        // 走了哪条路必须留痕：若冷启动总在吃 150ms 兜底，那是一笔可观的白等。
        // 上报放在 show 之前——探针在窗口可见后就杀进程，show 之后再报会被吃掉
        let rafPath = "fallback";
        const waitStart = performance.now();
        await Promise.race([
          new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => { rafPath = "raf"; resolve(null); }))),
          new Promise((resolve) => window.setTimeout(resolve, 150)),
        ]);
        void api
          .reportStartupMark("window_pre_show", Math.round(performance.now()), `${rafPath} wait_ms=${Math.round(performance.now() - waitStart)}`)
          .catch(() => undefined);
        try {
          await appWindow?.show();
          await appWindow?.setFocus();
        } catch {
          // 内容初始化不依赖窗口显示成功。
        }
        void api.reportStartupMark("window_shown", Math.round(performance.now())).catch(() => undefined);
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
      // 与 get_state 同源的顺带一步：读的是同一份 config.toml，只是比的对象换成 MCP 镜像。
      // 不在 MCP 页时也必须跑——侧栏角标就是为"不点进去也能发现"而存在的。
      checkMcpDiff();
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
  // 非静默启动时 onActive 已经在窗口聚焦那一刻查过了，这条定时器只补静默启动
  // （窗口不 show、拿不到焦点事件）那条路——不重复查第二遍。
  useEffect(() => {
    if (!startupReady) return;
    if (activationEpoch > 0) return;
    const timer = window.setTimeout(checkMcpDiff, 1500);
    return () => window.clearTimeout(timer);
  }, [startupReady, activationEpoch]);

  // 首屏稳定后预热管理页数据（MCP 列表 / Skill / 插件 / 市场 / Claude 供应商与 Claude MCP）：与差异检查同一波延迟，
  // fire-and-forget、失败无感——预热失败时页面进入仍走各页自己的加载路径。
  // 只在启动后跑一次；进页后的静默刷新由各页自持。各页首帧吃这批缓存直出（缓存在
  // useState 里同步初始化），启动后立刻点任何管理页都是整页内容，不出现转圈。
  useEffect(() => {
    if (!startupReady) return;
    const timer = window.setTimeout(() => {
      void loadMcpServers().catch(() => undefined);
      void loadSkills().catch(() => undefined);
      void loadPlugins().catch(() => undefined);
      void loadPluginMarketplaces().catch(() => undefined);
      void loadClaudeMcpServers().catch(() => undefined);
      void loadClaudeProfiles().catch(() => undefined);
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

  // 切页 = setView 换 Activity 的显隐，不强制重挂载：重复点击当前页由 setState bail-out
  // 保证无副作用，进入过的页面保住工作现场（编辑草稿、弹窗、页内滚动）。
  const navClass = "apple-sidebar-nav-button app-selection-state";

  // 各页内容唯一清单：Record 保证新增 AppView 分支时漏页是编译错误。
  // 渲染时只挂载进过的页面，当前页 visible、其余 hidden——hidden 的页面 effects 已
  // 清理（不加载、不轮询），state 与 DOM 保留，切回即恢复现场，effects 重跑后数据照常刷新。
  const renderPages = (state: AppState) => {
    const pages: Record<AppView, ReactNode> = {
      profiles: <ProfilesView state={state} authStatusReady={authStatusReady} activationEpoch={activationEpoch} coldStart={!startupReady} onRefresh={refresh} onManageChatgptAccounts={() => setView("accounts")} />,
      mcp: <McpView activationEpoch={activationEpoch} />,
      plugins: <PluginsView state={state} />,
      skills: <SkillsView activationEpoch={activationEpoch} />,
      claude: <ClaudeProfilesView activeId={state.active_claude_profile_id} onChanged={refresh} activationEpoch={activationEpoch} coldStart={!startupReady} balanceCache={state.balance_cache} />,
      accounts: <AccountsView initialStatus={state.auth_status} balanceCache={state.balance_cache} onAuthStatusChange={updateAuthStatus} />,
      settings: <SettingsView state={state} onPreviewTheme={previewTheme} onRefresh={refresh} onSaved={updateSettings} />,
    };
    return (Object.keys(pages) as AppView[]).map((pageView) =>
      visitedViews.has(pageView) ? (
        <Activity key={pageView} mode={view === pageView ? "visible" : "hidden"}>{pages[pageView]}</Activity>
      ) : null,
    );
  };

  // 侧栏分组（C 方案）：Codex / Claude / 通用导航。新增页面 = 数组加一条，不再手写按钮块；
  // 产品分组标识在收缩态仍可见，通用导航不显示多余分组标题。icon 存 ReactNode 以保留各页现有图标形态。
  // labelKey 用本地 key 联合（与 common/nav 资源同步），既过 i18next 强类型又保持条目形状统一。
  const sidebarGroups: { key: string; labelKey: SidebarLabelKey; items: { view: AppView; labelKey: SidebarLabelKey; icon: ReactNode; badgeText?: string; titleText?: string; onSelect: () => void }[] }[] = [
    {
      key: "codex",
      labelKey: "nav.groupCodex",
      items: [
        { view: "profiles", labelKey: "nav.providers", icon: <Layers2 strokeWidth={2} aria-hidden="true" />, onSelect: () => setView("profiles") },
        { view: "plugins", labelKey: "nav.plugins", icon: <Blocks strokeWidth={2} aria-hidden="true" />, onSelect: () => setView("plugins") },
        { view: "accounts", labelKey: "nav.accounts", icon: <CircleUserRound strokeWidth={2} aria-hidden="true" />, onSelect: () => setView("accounts") },
      ],
    },
    {
      key: "claude",
      labelKey: "nav.groupClaude",
      items: [
        { view: "claude", labelKey: "nav.claudeProviders", icon: <Layers2 strokeWidth={2} aria-hidden="true" />, onSelect: () => setView("claude") },
      ],
    },
    {
      key: "common",
      labelKey: "nav.groupCommon",
      items: [
        { view: "mcp", labelKey: "nav.mcp", icon: <McpIcon className="h-[18px] w-[18px]" />, badgeText: mcpBadge ?? undefined, titleText: mcpBadgeTitle, onSelect: () => setView("mcp") },
        { view: "skills", labelKey: "nav.skills", icon: <Puzzle strokeWidth={2} aria-hidden="true" />, onSelect: () => setView("skills") },
        { view: "settings", labelKey: "nav.settings", icon: <SettingsIcon strokeWidth={2} aria-hidden="true" />, onSelect: () => setView("settings") },
      ],
    },
  ];

  return (
    <FeedbackProvider>
      <TrayActions stateRef={stateRef} refresh={refresh} openSettings={() => setView("settings")} openAccounts={() => setView("accounts")} />
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
          <aside className={`apple-sidebar relative flex h-full shrink-0 flex-col ${sidebar.sidebarCollapsed ? "apple-sidebar--collapsed" : ""}`}>
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
            <nav className="mx-1.5 mt-3 space-y-3">
              {sidebarGroups.map((group) => (
                <div key={group.key} className="apple-sidebar-group" role="group" aria-label={group.key === "common" ? undefined : t(group.labelKey)}>
                  {group.key !== "common" ? <div className="apple-sidebar-group-label" aria-hidden="true">
                    {group.key === "codex" ? <img src="/codex.svg" alt="" /> : null}
                    {group.key === "claude" ? <img src="/claude-code.svg" alt="" /> : null}
                    <span className="apple-sidebar-label">{t(group.labelKey)}</span>
                  </div> : null}
                  <div className="space-y-1">
                    {group.items.map((item) => (
                      <button key={item.view} type="button" className={navClass} data-active={view === item.view ? "true" : undefined} aria-label={t(item.labelKey)} title={item.titleText} onClick={item.onSelect} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)}>
                        <span className="relative flex shrink-0">
                          {item.icon}
                          {item.badgeText ? <span className="apple-count-badge" aria-hidden="true">{item.badgeText}</span> : null}
                        </span>
                        <span className="apple-sidebar-label" aria-hidden={sidebar.sidebarCollapsed}>{t(item.labelKey)}</span>
                        {sidebar.sidebarCollapsed && sidebar.sidebarFlyoutArmed ? <span className="apple-sidebar-flyout" aria-hidden="true">{t(item.labelKey)}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
            <UpdateNotice className="update-notice--sidebar" sidebarCollapsed={sidebar.sidebarCollapsed} sidebarFlyoutArmed={sidebar.sidebarFlyoutArmed} onMouseEnter={() => sidebar.setSidebarFlyoutArmed(true)} />
          </aside>

          <main ref={mainRef} className="apple-main-card min-w-0 flex-1 overflow-y-auto overflow-x-hidden pt-4">
            {/* key 不含 view：view 变化只切 Activity 显隐，外层整树重挂载会清掉保活现场 */}
            <div key={state ? "app" : "loading"} className="apple-page-enter">
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
                renderPages(state)
              )}
            </div>
          </main>
        </div>
      </div>
      </AppUpdateProvider>
    </FeedbackProvider>
  );
}
