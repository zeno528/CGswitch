import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import { api, isTauri } from "../api";
import type { AppState, CodexAppStatus, Settings } from "../types";

export type AppView = "profiles" | "mcp" | "plugins" | "skills" | "settings";

export function indicatorTop(targetRect: { top: number }, navRect: { top: number }) {
  return targetRect.top - navRect.top + 8;
}

export function useAppState() {
  const [state, setState] = useState<AppState | null>(null);
  const [loadError, setLoadError] = useState("");
  const stateRef = useRef<AppState | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const refresh = useCallback(async () => {
    try {
      const nextState = await api.getState();
      const merged = stateRef.current ? { ...nextState, auth_status: stateRef.current.auth_status } : nextState;
      stateRef.current = merged;
      setState(merged);
      setLoadError("");
    } catch (error) {
      setLoadError(String(error));
    }
  }, []);

  const refreshAuthStatus = useCallback(async () => {
    try {
      const auth_status = await api.authGetStatus();
      const previous = stateRef.current;
      if (previous) {
        const next = { ...previous, auth_status };
        stateRef.current = next;
        setState(next);
      }
    } catch {
      // 首屏已经显示时，后台认证刷新失败保留旧快照。
    }
  }, []);

  const updateCodex = useCallback((codex: CodexAppStatus) => {
    const previous = stateRef.current;
    if (!previous) return;
    const next = { ...previous, codex };
    stateRef.current = next;
    setState(next);
  }, []);

  const updateSettings = useCallback((settings: Settings) => {
    const previous = stateRef.current;
    if (!previous) return;
    const next = { ...previous, settings };
    stateRef.current = next;
    setState(next);
  }, []);

  const previewTheme = useCallback((theme: Settings["theme"]) => {
    const previous = stateRef.current;
    if (!previous) return;
    const next = { ...previous, settings: { ...previous.settings, theme } };
    stateRef.current = next;
    setState(next);
  }, []);

  return { state, stateRef, loadError, refresh, refreshAuthStatus, updateCodex, updateSettings, previewTheme };
}

export function useThemeMode(theme: Settings["theme"] | undefined) {
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const isDark = theme === "dark" || ((theme ?? "system") === "system" && systemDark);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.add("theme-switching");
    root.classList.toggle("dark", isDark);
    root.style.colorScheme = isDark ? "dark" : "light";
    const frame = requestAnimationFrame(() => root.classList.remove("theme-switching"));
    if (isTauri) void api.setWindowTheme(isDark).catch(() => undefined);
    return () => cancelAnimationFrame(frame);
  }, [isDark]);

}

export function useCodexPolling(
  stateRef: MutableRefObject<AppState | null>,
  updateCodex: (codex: CodexAppStatus) => void,
) {
  const codexPollTimer = useRef<number | undefined>(undefined);
  const codexPolling = useRef(false);

  const pollCodexStatus = useCallback(async () => {
    if (codexPolling.current || !stateRef.current) return;
    codexPolling.current = true;
    try {
      updateCodex(await api.getCodexStatus());
    } catch {
      // 轮询失败保留上次状态。
    } finally {
      codexPolling.current = false;
    }
  }, [stateRef, updateCodex]);

  const stop = useCallback(() => {
    if (codexPollTimer.current !== undefined) {
      window.clearInterval(codexPollTimer.current);
      codexPollTimer.current = undefined;
    }
  }, []);

  const start = useCallback(() => {
    if (document.hidden || !stateRef.current) {
      stop();
      return;
    }
    if (codexPollTimer.current === undefined) {
      codexPollTimer.current = window.setInterval(() => void pollCodexStatus(), 3000);
    }
  }, [pollCodexStatus, stateRef, stop]);

  return { start, stop };
}

export function useActivationRefresh() {
  const [activationEpoch, setActivationEpoch] = useState(0);
  const activate = useCallback(() => setActivationEpoch((value) => value + 1), []);
  return { activationEpoch, activate };
}

export function useSidebarIndicator(view: AppView) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("cgswitch.sidebar-collapsed") !== "0",
  );
  const [sidebarFlyoutArmed, setSidebarFlyoutArmed] = useState(true);
  const [indicator, setIndicator] = useState({ top: 8, left: 0, instant: false });
  const profileNavRef = useRef<HTMLButtonElement>(null);
  const mcpNavRef = useRef<HTMLButtonElement>(null);
  const pluginsNavRef = useRef<HTMLButtonElement>(null);
  const skillsNavRef = useRef<HTMLButtonElement>(null);
  const settingsNavRef = useRef<HTMLButtonElement>(null);
  const sidebarNavRef = useRef<HTMLElement>(null);
  const previousViewRef = useRef<AppView>(view);

  const updateIndicator = useCallback(() => {
    const target = view === "profiles" ? profileNavRef.current : view === "mcp" ? mcpNavRef.current : view === "plugins" ? pluginsNavRef.current : view === "skills" ? skillsNavRef.current : settingsNavRef.current;
    const nav = sidebarNavRef.current;
    if (!target || !nav) return;
    setIndicator((current) => ({
      ...current,
      top: indicatorTop(target.getBoundingClientRect(), nav.getBoundingClientRect()),
      left: target.offsetLeft,
    }));
  }, [view]);

  useEffect(() => {
    const frame = requestAnimationFrame(updateIndicator);
    const previousView = previousViewRef.current;
    previousViewRef.current = view;
    if (previousView === view) return () => cancelAnimationFrame(frame);

    setIndicator((current) => ({
      ...current,
      instant: view === "settings" || previousView === "settings",
    }));
    const reset = requestAnimationFrame(() => {
      setIndicator((current) => ({ ...current, instant: false }));
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(reset);
    };
  }, [updateIndicator, sidebarCollapsed, view]);

  const toggleSidebar = () => {
    setSidebarCollapsed((collapsed) => {
      const next = !collapsed;
      localStorage.setItem("cgswitch.sidebar-collapsed", next ? "1" : "0");
      if (next) setSidebarFlyoutArmed(false);
      window.setTimeout(updateIndicator, 360);
      return next;
    });
  };

  return {
    sidebarCollapsed,
    sidebarFlyoutArmed,
    setSidebarFlyoutArmed,
    toggleSidebar,
    indicator,
    profileNavRef,
    mcpNavRef,
    pluginsNavRef,
    skillsNavRef,
    settingsNavRef,
    sidebarNavRef,
  };
}
