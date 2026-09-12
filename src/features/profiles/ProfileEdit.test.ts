// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProfileEdit.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const zhLocale = readFileSync(new URL("../../i18n/locales/zh-CN/profiles.ts", import.meta.url), "utf8");
const enLocale = readFileSync(new URL("../../i18n/locales/en-US/profiles.ts", import.meta.url), "utf8");

describe("ProfileEdit 用量查询", () => {
  it("新增态按所选预设显示支持的用量开关", () => {
    expect(source).toContain('const supportsBalance = create ? presetKind === "chatgpt" || balanceQueryProviders.has(selectedPreset?.provider ?? "") : isOfficial || balanceQueryProviders.has(detail?.provider ?? "");');
    expect(source).not.toContain('const isUsageProvider = create ? usageQueryProviders.has(selectedPreset?.provider ?? "") : usageQueryProviders.has(detail?.provider ?? "");');
    expect(source).not.toContain("{!create && supportsBalance ?");
  });

  it("用全局设置行呈现，并在新增后保存开启状态", () => {
    expect(source).toContain('className="mt-4 flex min-h-[var(--input-min-height)] items-center justify-between gap-4"');
    expect(source).toContain('className="setting-title"');
    expect(source).toContain('className="setting-description mt-0.5"');
    expect(source).toContain('t("edit.balanceUsage")');
    expect(source).not.toContain('t("edit.balanceChatgpt")');
    expect(source).not.toContain('t("edit.balanceBalance")');
    expect(source).not.toContain('t("edit.balanceBoth")');
    expect(source).not.toContain('title={t("edit.balanceAutoRefreshTitle")}');
    expect(source).toContain("if (showBalance) await api.setProfileShowBalance(created.id, true);");
    expect(source).not.toContain('<div className="app-input mt-4 flex items-center justify-between gap-3">');
  });

  it("新增态余额开关默认开启，编辑态仍由已存值覆盖", () => {
    expect(source).toContain('const isOfficial = create ? presetKind === "chatgpt" : profile?.kind === "official";');
    expect(source).toContain("const [showBalance, setShowBalance] = useState(create);");
    expect(source).toContain('setShowBalance(kind === "chatgpt" || balanceQueryProviders.has(preset.provider ?? ""));');
    expect(source).toContain("setShowBalance(loaded.show_balance);");
    expect(source).not.toContain("setShowBalance(false);");
  });

  it("自定义预设不预填名称和模型输入框", () => {
    expect(source).toContain('setName("");');
    expect(source).toContain('setName(kind === "custom" ? "" : preset.name);');
    expect(source).toContain('setModelValue(kind === "custom" ? "" : preset.model);');
  });

  it("保留说明文字，但移除说明文字的悬停提示", () => {
    expect(source).toContain('{t("edit.balanceAutoRefresh")}');
    expect(zhLocale).toContain('balanceAutoRefresh: "显示在供应商卡片，窗口激活时自动刷新"');
    expect(enLocale).toContain('balanceAutoRefresh: "Shown on provider cards; refreshes when the window is active"');
  });

  it("新建和编辑配置缺少密钥或 API 端点时只发合并通知并仍允许保存", () => {
    expect(source).toContain("const notifySaved = (message: string) => {");
    expect(source).toContain("if (!isOfficial && showProviderFields && (missingApiKey || missingBaseUrl)) {");
    expect(source).toContain('feedback.warning(t("edit.savedWithMissingFields", {');
    expect(source).toContain('message: create ? t("edit.providerAdded") : t("edit.providerUpdated"),');
    expect(source).toContain('notifySaved(t("edit.customProviderAdded"));');
    expect(source).not.toContain('feedback.warning(t("edit.apiKeySaveWarning"));');
    expect(zhLocale).toContain('savedWithMissingFields: "{{message}}；未填写{{fields}}，可能无法测试连通和用量查询"');
    expect(enLocale).toContain('savedWithMissingFields: "{{message}}; {{fields}} missing, connection tests and usage queries may not work"');
  });
});
