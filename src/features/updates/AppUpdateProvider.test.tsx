// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { FeedbackProvider } from "../../app/Feedback";
import { setupI18n } from "../../i18n";
import { AppUpdateProvider, releaseNotesUrl, UpdateNotice } from "./AppUpdateProvider";

const providerSource = readFileSync(new URL("./AppUpdateProvider.tsx", import.meta.url), "utf8");
const dialogSource = readFileSync(new URL("./UpdateNotesDialog.tsx", import.meta.url), "utf8");

const render = (enabled: boolean) => renderToStaticMarkup(
  <FeedbackProvider>
    <AppUpdateProvider enabled={enabled}>
      <UpdateNotice />
    </AppUpdateProvider>
  </FeedbackProvider>,
);

describe("AppUpdateProvider", () => {
  it("未发现更新时横幅不产出任何 UI", () => {
    setupI18n("zh-CN");
    expect(render(true)).toBe(render(false));
    expect(render(true)).not.toContain("新版本 v");
  });

  it("启动自动检查静默进行：发现新版只更新状态（横幅出现），失败只写 console", () => {
    expect(providerSource).toContain('console.warn("自动检查更新失败');
    expect(providerSource).not.toContain("feedback.info");
    expect(providerSource).toContain("autoCheckedRef.current = true");
  });

  it("升级走确认式弹窗：入口只负责打开弹窗，安装在弹窗内确认后触发，失败走 toast", () => {
    // 悬浮卡片不再直接安装，只打开更新日志弹窗
    expect(providerSource).not.toContain("void install()");
    expect(providerSource).toContain("setConfirming(true)");
    expect(providerSource).toContain("<UpdateNotesDialog");
    // 弹窗：日志 markdown 渲染、无日志兜底、「暂不升级 / 立即升级」双按钮
    expect(dialogSource).toContain("skill-markdown-preview");
    expect(dialogSource).toContain("<MarkdownPreview>{update.notes}</MarkdownPreview>");
    expect(dialogSource).toContain('t("notice.later")');
    expect(dialogSource).toContain("onOpenChange(false)");
    expect(dialogSource).toContain('t("notice.updateNow")');
    // 品牌渐变头部：项目 logo + 版本标题（hero 变体由 AppDialog 承载）
    expect(dialogSource).toContain('src="/logo.svg"');
    expect(dialogSource).toContain('t("notice.noNotes")');
    expect(dialogSource).toContain("void install()");
    expect(dialogSource).toContain('t("notice.updateNow")');
    expect(dialogSource).not.toContain("downloadAndInstall");
    // 安装失败 toast 的契约仍在 provider 的 install 回调里
    expect(providerSource).toContain("feedback.error(updateFailureMessage(error, t))");
  });

  it("GitHub 入口只在设置-关于页，弹窗内不再有更新日志按钮，悬浮卡片已移除", () => {
    const settingsSource = readFileSync(new URL("../settings/SettingsSections.tsx", import.meta.url), "utf8");
    expect(settingsSource).toContain("releaseNotesUrl(");
    expect(dialogSource).not.toContain("releaseNotesUrl");
    expect(providerSource).not.toContain("update-notice-popover");
    expect(providerSource).not.toContain("releases/latest");
  });

  it("更新日志直达对应版本的 Release 页面", () => {
    expect(releaseNotesUrl("0.13.10")).toBe("https://github.com/zeno528/CGswitch/releases/tag/v0.13.10");
    expect(releaseNotesUrl("v0.13.10")).toBe("https://github.com/zeno528/CGswitch/releases/tag/v0.13.10");
  });

  it("启动自动发现更新时不自动弹窗，图标点击直达确认弹窗", () => {
    expect(providerSource).not.toContain("autoOpened");
    expect(providerSource).not.toContain("pinned");
    expect(providerSource).not.toContain("installingHere");
    expect(providerSource).toContain("const [confirming, setConfirming] = useState(false);");
    expect(providerSource).toContain("onClick={() => setConfirming(true)}");
    expect(providerSource).not.toContain("onMouseEnter");
    expect(providerSource).toContain('aria-haspopup="dialog"');
  });

  it("悬浮卡片交互已整体移除，弹窗关闭由 Radix onOpenChange 承担", () => {
    expect(providerSource).not.toContain("closeOnOutsidePointer");
    expect(providerSource).not.toContain("noticeRef");
    expect(providerSource).toContain("onOpenChange={setConfirming}");
    // 更新消失（重查无新版）时收起弹窗，避免下次出现更新时误弹
    expect(providerSource).toContain("if (!update) setConfirming(false);");
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
