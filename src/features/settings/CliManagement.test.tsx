import { renderToStaticMarkup } from "react-dom/server";
import { Children, isValidElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { createInstance, type TFunction } from "i18next";
import enSettings from "../../i18n/locales/en-US/settings";
import zhSettings from "../../i18n/locales/zh-CN/settings";
import type { CliFailure, CliStatus } from "../../types";
import { CliCard, cliFailureMessage, useCliManagement } from "./CliManagement";

const hooks = vi.hoisted(() => ({
  cells: [] as unknown[], effects: [] as (() => void)[], index: 0, t: null as TFunction<"settings"> | null,
  error: vi.fn(), success: vi.fn(), command: vi.fn(),
  cached: vi.fn((): import("../../types").CliStatus | null => null), cacheSet: vi.fn(),
  proxyStatus: null as { proxy: string | null; error: boolean } | null,
  serviceQuiet: vi.fn(), serviceCheck: vi.fn(), touch: vi.fn(), cacheUpdate: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: (effect: () => void) => { hooks.effects.push(effect); },
  useRef: (initial: unknown) => {
    const index = hooks.index++;
    hooks.cells[index] ??= { current: initial };
    return hooks.cells[index];
  },
  useState: (initial: unknown) => {
    const index = hooks.index++;
    if (!(index in hooks.cells)) hooks.cells[index] = initial;
    return [hooks.cells[index], (value: unknown) => { hooks.cells[index] = value; }];
  },
}));
vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: hooks.t ?? ((key: string, options?: { version?: string }) => `${key}${options?.version ?? ""}`) }) }));
vi.mock("../../app/Feedback", () => ({ useFeedback: () => ({ error: hooks.error, success: hooks.success }) }));
vi.mock("../../app/managementDataCache", () => ({ getCachedCliStatus: hooks.cached, setCliStatusCache: hooks.cacheSet, getCachedProxyStatus: () => null, loadProxyStatus: hooks.command, runCliUpdateCheck: hooks.serviceCheck, runCliUpdateCheckQuietly: hooks.serviceQuiet, touchCliUpdateCheckedAt: hooks.touch, setCachedCliUpdate: hooks.cacheUpdate }));
vi.mock("../../app/useProxyStatus", () => ({ useProxyStatus: () => hooks.proxyStatus ?? null }));
vi.mock("../../api", () => ({ api: {
  codexGetCliStatus: hooks.command, codexCheckCliUpdate: hooks.command, codexInstallCli: hooks.command, codexUpdateCli: hooks.command,
  claudeGetCliStatus: hooks.command, claudeCheckCliUpdate: hooks.command, claudeInstallCli: hooks.command, claudeUpdateCli: hooks.command,
} }));
beforeEach(() => {
  hooks.cells.length = 0;
  hooks.effects.length = 0;
  hooks.index = 0;
  hooks.t = null;
  hooks.command.mockReset();
  hooks.error.mockClear();
  hooks.success.mockClear();
  hooks.cached.mockClear().mockReturnValue(null);
  hooks.cacheSet.mockClear();
  hooks.proxyStatus = null;
  hooks.serviceQuiet.mockReset();
  hooks.serviceCheck.mockReset();
  hooks.touch.mockClear();
  hooks.cacheUpdate.mockClear();
});

const status: CliStatus = {
  installation: "native", source: null, version: "1.2.3", path: "/fixture/bin/cli", other_paths: [],
  platform: "darwin-arm64", network: "direct", proxy: null, busy: false,
};
const management = {
  status, update: null, busy: false, operation: null, error: null, refresh: vi.fn(), check: vi.fn(), run: vi.fn(),
};
// 清空全部微任务：effect 里检测 → 静默更新检查是链式异步，单次微任务等不完。
const flush = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

it.each(["codex", "claude"] as const)("%s 每次重新进入都刷新本地并静默检查更新", async (client) => {
  const render = (active: boolean) => { hooks.index = 0; const current = useCliManagement(client, active); hooks.effects[hooks.effects.length - 1](); return current; };
  render(false);
  expect(hooks.command).not.toHaveBeenCalled();
  const checked = { status, latest_version: "1.2.4", channel: "latest", available: true };
  hooks.command.mockResolvedValueOnce(status); // 本地检测
  hooks.serviceQuiet.mockResolvedValueOnce(checked); // 静默更新检查走共享服务
  render(true);
  await flush();
  const restored = render(true);
  expect(restored.status).toEqual(status);
  expect(restored.update).toEqual(checked); // 静默检查发现新版本 → 升级胶囊就位
  const refreshed = { ...status, version: "1.2.4", path: "/fixture/bin/cli-v2" };
  const checkedAgain = { status: refreshed, latest_version: "1.2.5", channel: "latest", available: false };
  hooks.command.mockResolvedValueOnce(refreshed);
  hooks.serviceQuiet.mockResolvedValueOnce(checkedAgain);
  render(false);
  render(true);
  await flush();
  const reentered = render(true);
  expect(hooks.command).toHaveBeenCalledTimes(2);
  expect(hooks.serviceQuiet).toHaveBeenCalledTimes(2);
  expect(reentered.status).toEqual(refreshed);
  const html = renderToStaticMarkup(<CliCard client={client} management={reentered} />);
  expect(html).toContain(refreshed.path!);
  hooks.serviceCheck.mockResolvedValueOnce(checkedAgain);
  await reentered.check(); // 主动检查更新仍可用（走共享服务）
  expect(render(true).update).toEqual(checkedAgain);
  expect(hooks.command).toHaveBeenCalledTimes(2);
});

it("进入分区首帧直出缓存状态不闪骨架，静默刷新补齐最新值并写穿缓存", async () => {
  const cached = { ...status, version: "1.2.0" };
  const checked = { status, latest_version: "1.2.4", channel: "latest", available: false };
  hooks.cached.mockReturnValueOnce(cached);
  hooks.command.mockResolvedValueOnce(status);
  hooks.serviceQuiet.mockResolvedValueOnce(checked);
  const render = (active: boolean) => { hooks.index = 0; const current = useCliManagement("codex", active); hooks.effects[hooks.effects.length - 1](); return current; };
  // 首帧断言：不等任何异步，缓存值必须已经在状态里（闪骨架 = 这里拿到 null）
  const first = render(true);
  expect(first.status).toEqual(cached);
  await flush();
  const settled = render(true);
  expect(settled.status).toEqual(status);
  expect(hooks.command).toHaveBeenCalledOnce();
  expect(hooks.cacheSet).toHaveBeenCalledWith("codex", status);
  hooks.command.mockResolvedValueOnce(status);
  hooks.serviceQuiet.mockResolvedValueOnce(checked);
  render(false);
  const reentered = render(true);
  expect(reentered.status).toEqual(status);
  await flush();
  expect(hooks.command).toHaveBeenCalledTimes(2);
});

it("静默更新检查失败不打扰界面，主动检查失败才透出", async () => {
  const render = (active: boolean) => { hooks.index = 0; const current = useCliManagement("codex", active); hooks.effects[hooks.effects.length - 1](); return current; };
  const failure = { stage: "fetch_version", kind: "timeout", message: "fixture" };
  hooks.command.mockResolvedValueOnce(status);
  hooks.serviceQuiet.mockResolvedValueOnce(null); // 静默失败：服务吞错返回 null
  render(true);
  await flush();
  const settled = render(true);
  expect(settled.status).toEqual(status);
  expect(settled.error).toBeNull(); // 静默失败只留后端日志，不进界面
  expect(settled.update).toBeNull();
  hooks.serviceCheck.mockRejectedValueOnce(failure);
  await settled.check(); // 主动检查失败照常透出
  expect(render(true).error).toEqual(failure);
  expect(hooks.touch).toHaveBeenCalledWith("codex"); // 手动失败推进冷却闸
});

it("离开分区丢弃一次性无更新反馈，升级胶囊保留", async () => {
  const render = (active: boolean) => { hooks.index = 0; const current = useCliManagement("codex", active); hooks.effects[hooks.effects.length - 1](); return current; };
  const noUpdate = { status, latest_version: "1.2.4", channel: "latest", available: false };
  // 首次进入：检测（api）+ 静默检查（共享服务）；无更新不落状态，卡片保持干净
  hooks.command.mockResolvedValueOnce(status);
  hooks.serviceQuiet.mockResolvedValueOnce(noUpdate);
  const current = render(true);
  await flush();
  expect(render(true).update).toBeNull();
  hooks.serviceCheck.mockResolvedValueOnce(noUpdate);
  await current.check(); // 主动检查的无更新反馈是瞬时状态
  expect(render(true).update).toEqual(noUpdate);
  render(false); // 离开分区
  expect(render(false).update).toBeNull(); // 无更新反馈不常驻
  const upgrade = { status, latest_version: "1.2.4", channel: "latest", available: true };
  hooks.command.mockResolvedValueOnce(status);
  hooks.serviceQuiet.mockResolvedValueOnce(upgrade);
  render(false);
  render(true);
  await flush();
  expect(render(true).update).toEqual(upgrade); // 可行动的升级胶囊保留
});

it("首次检测失败后再次进入仍可重试，未安装结果也会保留", async () => {
  const render = (active: boolean) => { hooks.index = 0; const current = useCliManagement("codex", active); hooks.effects[hooks.effects.length - 1](); return current; };
  hooks.command.mockRejectedValueOnce({ stage: "detect", kind: "io_error", message: "fixture" });
  render(true);
  await Promise.resolve();
  expect(render(false).status).toBeNull();
  const missing = { ...status, installation: "missing" as const, version: null, path: null };
  hooks.command.mockResolvedValueOnce(missing);
  render(true);
  await Promise.resolve();
  expect(render(true).status).toEqual(missing);
  expect(hooks.command).toHaveBeenCalledTimes(2);
});

it("两端卡片共用行为，运行中的 Codex 不会禁用 Claude 按钮", () => {
  const codex = renderToStaticMarkup(<CliCard client="codex" management={{
    ...management, busy: true,
    operation: "install" as const,
  }} />);
  const claude = renderToStaticMarkup(<CliCard client="claude" management={management} />);
  expect(codex.match(/disabled=""/g)).toHaveLength(1);
  expect(codex).toContain("animate-spin");
  expect(codex).toContain("cli.installing");
  expect(codex).toContain('role="status"');
  expect(codex).toContain('aria-live="polite"');
  expect(claude).not.toContain('disabled=""');
  expect(claude).not.toContain("animate-spin");
  expect(claude).toContain("cli.checkUpdate");
  expect(claude).not.toContain("cli.updateTo");
});

it("进行中反馈按动作显示对应文案", () => {
  const render = (operation: "refresh" | "check" | "install" | "update") => renderToStaticMarkup(<CliCard client="codex" management={{
    ...management, busy: true, operation,
  }} />);
  expect(render("refresh")).not.toContain("cli.refreshing");
  expect(render("refresh")).not.toContain('role="status"');
  expect(render("check")).toContain("cli.checkingUpdate");
  expect(render("install")).toContain("cli.installing");
  expect(render("update")).toContain("cli.updating");
});

it("按客户端显示实际安装来源", () => {
  const claude = renderToStaticMarkup(<CliCard client="claude" management={{
    ...management, status: { ...status, source: "native" },
  }} />);
  const codex = renderToStaticMarkup(<CliCard client="codex" management={{
    ...management, status: { ...status, installation: "missing", source: "embedded", version: null },
  }} />);
  expect(claude).toContain("cli.sources.claude.native");
  expect(claude).toContain('class="plan-badge">cli.sources.claude.native</span>');
  expect(claude).not.toContain("apple-chip--success");
  expect(codex).toContain("cli.sources.codex.embedded");
  expect(codex.indexOf("cli.sources.codex.embedded")).toBeLessThan(codex.indexOf("cli.missing"));
});

it("网络地址复用路径高亮块，连接方式与网络标签分层", () => {
  const html = renderToStaticMarkup(<CliCard client="codex" management={{
    ...management, status: { ...status, network: "proxy", proxy: "http://proxy.invalid:9001" },
  }} />);
  expect(html).toContain('class="meta-xs">cli.networkLabel</span>');
  expect(html).toContain('class="cli-fact-value">cli.proxy</span>');
  expect(html).toContain('class="cli-fact-path" title="http://proxy.invalid:9001">http://proxy.invalid:9001</span>');
});

it("网络行读共享代理订阅而非检测快照，两卡片同源同步", () => {
  hooks.proxyStatus = { proxy: "http://proxy.invalid:9002", error: false };
  const html = renderToStaticMarkup(<CliCard client="codex" management={{
    ...management, status: { ...status, network: "proxy", proxy: "http://proxy.invalid:9001" },
  }} />);
  expect(html).toContain('title="http://proxy.invalid:9002"');
  expect(html).not.toContain("proxy.invalid:9001");
});

it("版本查询错误随界面语言翻译，不显示后端中文或内部阶段标识", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "en-US", defaultNS: "settings", resources: {
    "en-US": { settings: enSettings }, "zh-CN": { settings: zhSettings },
  } });
  const failure: CliFailure = { stage: "fetch_version", kind: "timeout", message: "版本查询超时，请检查网络或代理" };
  hooks.t = i18n.getFixedT("en-US", "settings");
  for (const client of ["codex", "claude"] as const) {
    const html = renderToStaticMarkup(<CliCard client={client} management={{ ...management, error: failure }} />);
    expect(html.match(/role="alert"/g)).toHaveLength(1);
    expect(html).toContain("Update check failed. The version query timed out. Check your network or proxy and retry.");
    expect(html).not.toMatch(/fetch_version|版本查询/);
    for (const kind of ["network_error", "parse_error", "unknown"]) {
      const message = cliFailureMessage({ ...failure, kind }, client, hooks.t);
      expect(message).not.toMatch(/版本查询|cli\./);
    }
  }
  expect(cliFailureMessage(failure, "claude", hooks.t)).toBe("Claude Code: Update check failed. The version query timed out. Check your network or proxy and retry.");
  hooks.t = i18n.getFixedT("zh-CN", "settings");
  const chinese = renderToStaticMarkup(<CliCard client="claude" management={{ ...management, error: failure }} />);
  expect(chinese).toContain("检查更新失败");
  expect(chinese).toContain(failure.message);
  expect(chinese).not.toContain("Update check failed");
});

it("两端的失败操作只更新卡片，不弹成功通知", async () => {
  const failure: CliFailure = { stage: "fetch_version", kind: "timeout", message: "诊断信息" };
  for (const client of ["codex", "claude"] as const) {
    hooks.cells.length = 0;
    hooks.success.mockClear();
    const render = () => { hooks.index = 0; return useCliManagement(client, false); };
    for (const action of ["refresh", "check", "install", "update"] as const) {
      if (action === "update") {
        hooks.serviceCheck.mockResolvedValueOnce({ status, latest_version: "1.2.4", channel: "latest", available: true });
        await render().check();
      }
      if (action === "refresh") hooks.command.mockRejectedValueOnce(failure);
      else if (action === "check") hooks.serviceCheck.mockRejectedValueOnce(failure);
      else hooks.command.mockRejectedValueOnce(failure);
      const current = render();
      await (action === "refresh" ? current.refresh() : action === "check" ? current.check() : current.run(action === "install"));
      expect(render().error).toEqual(failure);
      expect(render().busy).toBe(false);
      expect(hooks.error).not.toHaveBeenCalled();
      expect(hooks.success).not.toHaveBeenCalled();
    }
    hooks.command.mockResolvedValueOnce(status);
    await render().run(true);
    expect(render().status).toEqual(status);
    expect(render().error).toBeNull();
    expect(hooks.success).toHaveBeenCalledOnce();
    expect(hooks.success).toHaveBeenCalledWith("cli.installComplete1.2.3");
    expect(hooks.error).not.toHaveBeenCalled();
  }
});

it("升级成功后发出升级完成通知", async () => {
  const i18n = createInstance();
  await i18n.init({ lng: "zh-CN", defaultNS: "settings", resources: { "zh-CN": { settings: zhSettings } } });
  hooks.t = i18n.getFixedT("zh-CN", "settings");
  hooks.serviceCheck.mockResolvedValueOnce({ status, latest_version: "1.2.4", channel: "latest", available: true });
  hooks.index = 0;
  await useCliManagement("claude", false).check();
  hooks.command.mockResolvedValueOnce({ ...status, version: "1.2.4" });
  hooks.index = 0;
  await useCliManagement("claude", false).run(false);
  expect(hooks.success).toHaveBeenCalledOnce();
  expect(hooks.success).toHaveBeenCalledWith("Claude Code 已更新至 v1.2.4");
  // 升级成功的权威落点：共享更新缓存立即翻转，供应商页胶囊同步消失
  expect(hooks.cacheUpdate).toHaveBeenCalledWith("claude", { available: false, latest_version: "1.2.4", channel: "latest" });
});

function buttons(node: ReactNode): { children?: ReactNode; onClick: () => void }[] {
  const result: { children?: ReactNode; onClick: () => void }[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<{ children?: ReactNode; onClick: () => void }>(child)) return;
    if (child.type === "button") result.push(child.props);
    else result.push(...buttons(child.props.children));
  });
  return result;
}

it("检查只查询，发现更新后仍需单独点击升级；没有更新时不提供升级", () => {
  for (const client of ["codex", "claude"] as const) {
    const actions = { ...management, check: vi.fn(), run: vi.fn() };
    const unchecked = CliCard({ client, management: actions });
    buttons(unchecked).find((button) => button.children === "cli.checkUpdate")!.onClick();
    expect(actions.check).toHaveBeenCalledOnce();
    expect(actions.run).not.toHaveBeenCalled();
    for (const available of [false, true]) {
      const checked = CliCard({ client, management: { ...actions, update: {
        status, latest_version: "1.2.4", channel: "latest", available,
      } } });
      const upgrade = buttons(checked).find((button) => [button.children].flat().some((child) => typeof child === "string" && child.startsWith("cli.updateTo")));
      expect(Boolean(upgrade)).toBe(available);
      expect(renderToStaticMarkup(checked)).toContain(available ? "cli.updateAvailable1.2.4" : "cli.noUpdate1.2.4");
      expect(actions.run).not.toHaveBeenCalled();
      if (upgrade) {
        upgrade.onClick();
        expect(actions.run).toHaveBeenCalledExactlyOnceWith(false);
      }
    }
  }
});

it("版本号与升级按钮复用订阅等级徽标尺寸", () => {
  const html = renderToStaticMarkup(<CliCard client="claude" management={{ ...management, update: {
    status, latest_version: "1.2.4", channel: "latest", available: true,
  } }} />);
  expect(html).toContain('class="plan-badge">1.2.3</span>');
  expect(html).toContain('class="plan-badge cli-upgrade-pill"');
});

it("混装与其他任务阻止安装，桌面内置副本可以共存", () => {
  for (const installation of ["other", "conflict"] as const) {
    const card = renderToStaticMarkup(<CliCard client="codex" management={{
      ...management, status: { ...status, installation },
    }} />);
    expect(card.match(/disabled=""/g)).toHaveLength(1);
  }
  const card = renderToStaticMarkup(<CliCard client="codex" management={{
    ...management, status: { ...status, installation: "missing", version: null, embedded_paths: ["/fixture/desktop"] },
  }} />);
  expect(card).not.toContain('disabled=""');
  expect(card).toContain("cli.install");
  expect(card).toContain("app-button--primary");
  expect(card).toContain("cli.embedded");
  const remoteTask = renderToStaticMarkup(<CliCard client="claude" management={{
    ...management, status: { ...status, busy: true },
  }} />);
  expect(remoteTask.match(/disabled=""/g)).toHaveLength(1);
});
