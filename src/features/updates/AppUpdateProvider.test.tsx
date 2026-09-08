// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackProvider } from "../../app/Feedback";
import { AppUpdateProvider, UpdateNotice } from "./AppUpdateProvider";

const providerSource = readFileSync(new URL("./AppUpdateProvider.tsx", import.meta.url), "utf8");

const render = (enabled: boolean) => renderToStaticMarkup(
  <FeedbackProvider>
    <AppUpdateProvider enabled={enabled}>
      <UpdateNotice />
    </AppUpdateProvider>
  </FeedbackProvider>,
);

describe("AppUpdateProvider", () => {
  it("未发现更新时横幅不产出任何 UI", () => {
    expect(render(true)).toBe(render(false));
    expect(render(true)).not.toContain("新版本 v");
  });

  it("启动自动检查静默进行：发现新版只更新状态（横幅出现），失败只写 console", () => {
    expect(providerSource).toContain('console.warn("自动检查更新失败');
    expect(providerSource).not.toContain("feedback.info");
    expect(providerSource).toContain("autoCheckedRef.current = true");
  });

  it("升级必须由用户点击「立即升级」触发，安装失败走 toast", () => {
    expect(providerSource).toContain("立即升级");
    expect(providerSource).toContain("feedback.error(updateFailureMessage(error))");
    expect(providerSource).not.toContain("downloadAndInstall");
  });

  it("悬浮卡片提供更新日志入口（GitHub 最新 Release 页）", () => {
    expect(providerSource).toContain("更新日志");
    expect(providerSource).toContain("releases/latest");
  });

  it("启动自动发现更新时自动展开，关闭后仍可从侧边栏入口再次查看", () => {
    expect(providerSource).toContain('if (update && updateSource === "sidebar") setAutoOpened(true);');
    expect(providerSource).toContain('const open = autoOpened || hovered || pinned || installingHere;');
    expect(providerSource).toContain('aria-label="关闭更新提示"');
    expect(providerSource).toContain("setAutoOpened(false);");
  });

  it("升级期间悬浮卡片强制保持显示，但仅限侧边栏发起的升级", () => {
    expect(providerSource).toContain("const installingHere = installing && updateSource === \"sidebar\";");
  });
});
