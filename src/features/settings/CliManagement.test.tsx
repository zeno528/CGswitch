import { renderToStaticMarkup } from "react-dom/server";
import { Children, isValidElement, type ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { createInstance, type TFunction } from "i18next";
import enSettings from "../../i18n/locales/en-US/settings";
import zhSettings from "../../i18n/locales/zh-CN/settings";
import type { CliFailure, CliStatus } from "../../types";
import { CliCard, cliFailureMessage, useCliManagement } from "./CliManagement";

const hooks = vi.hoisted(() => ({ cells: [] as unknown[], index: 0, t: null as TFunction<"settings"> | null, error: vi.fn(), success: vi.fn(), command: vi.fn() }));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useEffect: () => undefined,
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
vi.mock("../../api", () => ({ api: {
  codexGetCliStatus: hooks.command, codexCheckCliUpdate: hooks.command, codexInstallCli: hooks.command, codexUpdateCli: hooks.command,
  claudeGetCliStatus: hooks.command, claudeCheckCliUpdate: hooks.command, claudeInstallCli: hooks.command, claudeUpdateCli: hooks.command,
} }));
beforeEach(() => {
  hooks.cells.length = 0;
  hooks.index = 0;
  hooks.t = null;
  hooks.command.mockReset();
  hooks.error.mockClear();
  hooks.success.mockClear();
});

const status: CliStatus = {
  installation: "native", version: "1.2.3", path: "/fixture/bin/cli", other_paths: [],
  platform: "darwin-arm64", network: "direct", proxy: null, busy: false,
};
const management = {
  status, update: null, busy: false, progress: null, error: null, refresh: vi.fn(), check: vi.fn(), run: vi.fn(),
};

it("两端卡片共用行为，运行中的 Codex 不会禁用 Claude 按钮", () => {
  const codex = renderToStaticMarkup(<CliCard client="codex" management={{
    ...management, busy: true,
    progress: { stage: "run_cli", task_id: "codex-task" },
  }} />);
  const claude = renderToStaticMarkup(<CliCard client="claude" management={management} />);
  expect(codex.match(/disabled=""/g)).toHaveLength(2);
  expect(codex).toContain("animate-spin");
  expect(codex).toContain("cli.stages.run_cli");
  expect(codex).toContain('role="status"');
  expect(codex).toContain('aria-live="polite"');
  expect(claude).not.toContain('disabled=""');
  expect(claude).not.toContain("animate-spin");
  expect(claude).toContain("cli.checkUpdate");
  expect(claude).not.toContain("cli.updateTo");
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

it("两端的检测、检查、安装与升级只更新卡片，成功或失败均不弹重复通知", async () => {
  const failure: CliFailure = { stage: "fetch_version", kind: "timeout", message: "诊断信息" };
  for (const client of ["codex", "claude"] as const) {
    hooks.cells.length = 0;
    const render = () => { hooks.index = 0; return useCliManagement(client, false); };
    for (const action of ["refresh", "check", "install", "update"] as const) {
      if (action === "update") {
        hooks.command.mockResolvedValueOnce({ status, latest_version: "1.2.4", channel: "latest", available: true });
        await render().check();
      }
      hooks.command.mockRejectedValueOnce(failure);
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
    expect(hooks.success).not.toHaveBeenCalled();
    expect(hooks.error).not.toHaveBeenCalled();
  }
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
  expect(html).toContain('class="plan-badge mono">1.2.3</span>');
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
  expect(card).toContain("cli.embedded");
  const remoteTask = renderToStaticMarkup(<CliCard client="claude" management={{
    ...management, status: { ...status, busy: true },
  }} />);
  expect(remoteTask.match(/disabled=""/g)).toHaveLength(1);
});
