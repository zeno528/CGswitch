import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AppShell from "./app/AppShell";
import { AppErrorBoundary } from "./app/AppErrorBoundary";
import { setupI18n } from "./i18n";
import "./style.css";

// 首绘先按系统语言渲染；真实设置加载后由 AppShell 在显示窗口前切换，用户看不到中间态。
setupI18n(undefined);

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    <AppErrorBoundary>
      <AppShell />
    </AppErrorBoundary>
  </StrictMode>,
);
