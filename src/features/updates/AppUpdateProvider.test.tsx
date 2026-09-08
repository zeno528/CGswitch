// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackProvider } from "../../app/Feedback";
import { AppUpdateProvider, releaseNotesUrl, UpdateNotice } from "./AppUpdateProvider";

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
    expect(providerSource).toContain("releases/tag/v");
    expect(providerSource).not.toContain("releases/latest");
  });

  it("更新日志直达对应版本的 Release 页面", () => {
    expect(releaseNotesUrl("0.13.10")).toBe("https://github.com/zeno528/CGswitch/releases/tag/v0.13.10");
    expect(releaseNotesUrl("v0.13.10")).toBe("https://github.com/zeno528/CGswitch/releases/tag/v0.13.10");
  });

  it("启动自动发现更新时不自动展开，卡片由点击打开", () => {
    expect(providerSource).not.toContain("autoOpened");
    expect(providerSource).not.toContain("pinned");
    expect(providerSource).not.toContain("installingHere");
    expect(providerSource).toContain("const [open, setOpen] = useState(false);");
    expect(providerSource).toContain("onClick={() => setOpen((value) => !value)}");
    expect(providerSource).not.toContain("onMouseEnter={() => setHovered(true)}");
    expect(providerSource).not.toContain("const open = hovered;");
    expect(providerSource).toContain('aria-label="关闭更新提示"');
  });

  it("点击卡片外部或关闭按钮可以收起更新卡片", () => {
    expect(providerSource).toContain("document.addEventListener(\"pointerdown\", closeOnOutsidePointer);");
    expect(providerSource).toContain("if (noticeRef.current?.contains(event.target as Node)) return;");
    expect(providerSource).toContain("setOpen(false);");
  });

  it("更新入口只显示在 Codex 状态旁，不再渲染侧边栏横幅", () => {
    const appShellSource = readFileSync(new URL("../../app/AppShell.tsx", import.meta.url), "utf8");
    const profilesSource = readFileSync(new URL("../profiles/ProfilesView.tsx", import.meta.url), "utf8");
    expect(appShellSource).not.toContain("<UpdateNotice />");
    expect(profilesSource).toContain("<UpdateNotice />");
    expect(providerSource).not.toContain("apple-sidebar-label");
    expect(providerSource).toContain('className="update-notice-trigger"');
  });
});
