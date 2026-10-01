// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setupI18n } from "../../i18n";
import { compareMcpServers, McpServerRow } from "./McpView";

const viewSource = readFileSync(new URL("./McpView.tsx", import.meta.url), "utf8");
const editSource = readFileSync(new URL("./McpEdit.tsx", import.meta.url), "utf8");
const claudeEditSource = readFileSync(new URL("./ClaudeMcpEdit.tsx", import.meta.url), "utf8");
const sharedFormSource = readFileSync(new URL("./McpConnectionForm.tsx", import.meta.url), "utf8");

describe("MCP 操作入口", () => {
  it("两个客户端共用编辑标题、按钮、通知和卸载确认文案", () => {
    for (const key of [
      "edit.back", "edit.createTitle", "edit.editTitle", "edit.uninstall",
      "edit.name", "edit.namePlaceholder", "edit.format", "edit.cancel", "edit.saving", "edit.save",
      "feedback.formatted", "feedback.formatFailed", "feedback.invalidName", "feedback.saved",
    ]) {
      expect(editSource + sharedFormSource).toContain(`t("${key}"`);
      expect(claudeEditSource + sharedFormSource).toContain(`t("${key}"`);
    }
    const claudeView = viewSource.slice(viewSource.indexOf("function ClaudeMcpView("));
    for (const key of ["confirm.deleteTitle", "confirm.deleteDescription", "confirm.delete", "feedback.deleted", "empty.description"]) {
      expect(viewSource).toContain(key);
      expect(claudeView).toContain(key);
    }
    expect(claudeEditSource + viewSource).not.toContain('"claude.');
  });

  it("列表只保留右侧编辑、测试、工具和开关操作", () => {
    expect(viewSource).toContain("<Pencil");
    expect(viewSource).toContain("<Wrench");
    expect(viewSource).toContain('className="apple-icon-button');
    expect(viewSource).not.toContain('t("list.editButton")');
    expect(viewSource).toContain('onDelete={editingServer ? () => removeServer(editingServer) : undefined}');
    expect(viewSource).not.toContain("cursor-pointer");
    expect(viewSource).not.toContain("group-hover");
    expect(viewSource).not.toContain("<TrashIcon");
  });

  it("编辑页为已有 MCP 提供卸载入口", () => {
    expect(editSource).toContain("onDelete?: () => Promise<void>");
    expect(editSource).toContain("!create && onDelete");
    expect(editSource).toContain('{t("edit.uninstall")}');
  });

  it("源码编辑不触发保存，普通输入保留回车保存", () => {
    for (const source of [editSource, claudeEditSource]) {
      expect(source).toContain('event.key === "Enter" && !event.nativeEvent.isComposing && !(event.target instanceof Element && event.target.closest("textarea, .apple-editor-shell"))');
      expect(source).not.toContain('event.ctrlKey && event.key === "Enter"');
    }
  });

  it("两端复用连接表单，Claude 保留原生 JSON 保存入口和毫秒超时", () => {
    for (const source of [editSource, claudeEditSource]) expect(source).toContain("<McpConnectionForm");
    expect(claudeEditSource).toContain("patchClaudeMcpForm(jsonText, next, field)");
    expect(claudeEditSource).toContain("onChange={editJson}");
    expect(claudeEditSource).toContain("disabled={!initialized || !formValid || saving}");
    expect(claudeEditSource).toContain("api.saveClaudeMcpServer(server?.name ?? null, trimmedName, jsonText)");
    expect(claudeEditSource).toContain("min={1000} step={1000}");
    expect(claudeEditSource).not.toContain("startupTimeout");
  });

  it("共享表单把高级选项箭头放在右侧，环境变量使用添加变量，启动参数独占一行", () => {
    expect(sharedFormSource).toContain("showIcon");
    expect(sharedFormSource).toContain('iconPosition="start"');
    expect(sharedFormSource).toContain('className="mcp-advanced-disclosure mt-3"');
    expect(sharedFormSource).not.toContain("<ChevronRight className=\"apple-disclosure__icon\"");
    expect(sharedFormSource).toContain('t("edit.addVariable")');
    expect(sharedFormSource).toContain("ArgsEditor");
    expect(sharedFormSource).toContain('text ? text.split(/\\r?\\n/) : [""]');
    expect(sharedFormSource).toContain('t("edit.addArgument")');
    expect(sharedFormSource).not.toContain("<textarea");
    // 只剩名称/传输类型一处在用双列网格，启动参数不再与启动命令同排
    expect(sharedFormSource.match(/sm:grid-cols-2/g)).toHaveLength(1);
    // 环境变量/请求头为空时兜底一行占位空行
    expect(sharedFormSource).toContain("const rows = pairs.length ? pairs : [{ key: \"\", value: \"\" }];");
    // 行删除按钮只在仅剩一行且为空时禁用；多行时空行也按行删除
    expect(sharedFormSource).toContain("disabled={args.length === 1 && !arg.trim()}");
    expect(sharedFormSource).toContain("disabled={rows.length === 1 && !pair.key.trim() && !pair.value.trim()}");
    // 请求头不做掩码显示，没有查看小眼睛
    expect(sharedFormSource).not.toContain("maskValue");
    expect(sharedFormSource).not.toContain("EyeOff");
  });

  it("进入列表只做静默连通性探测，工具按钮才刷新工具", () => {
    expect(viewSource).not.toContain("MCP_STATUS_REFRESH_MS");
    expect(viewSource).toContain("probe(server, { manual: false })");
    // 工具只从扳手来（保存等其余路径一律只验连通性，不拉清单）
    expect([...viewSource.matchAll(/probe\(server, \{ includeTools: true \}\)/g)]).toHaveLength(1);
    expect(viewSource).toContain("api.probeMcpServer(name, includeTools, manual, scope)");
  });

  it("Claude MCP 复用共享列表和探测缓存，进页不重新点亮状态灯", () => {
    expect(viewSource).toContain("getCachedClaudeMcpServers()");
    expect(viewSource).toContain('useMcpProbes("claude"');
    expect(viewSource).toContain("applyCache(next)");
    expect(viewSource).not.toContain("setProbeResults({});");
  });

  it("Claude MCP 进页和激活强刷列表，单条保存、删除和开关不全量重探", () => {
    const claude = viewSource.slice(viewSource.indexOf("function ClaudeMcpView("));
    expect(claude).toContain("void refresh(true);");
    expect(claude).toContain("void refresh(true, []); }, [activationEpoch]");
    expect(claude).toContain("await refresh(true, []);");
    expect(claude).toContain("void refresh(true, [name]);");
    expect(claude).toContain("refresh(true, enabled ? [target.name] : [])");
    expect(claude).toContain("only ? next.filter((server) => only.includes(server.name)) : next");
  });

  it("MCP 卡片空白处可折叠且不抢占操作控件", () => {
    expect(viewSource).toContain('event.target.closest(\'button, input, code, [role="switch"]\')');
    expect(viewSource).toContain("if (!detailsVisible");
    expect(viewSource).toContain("onToggleTools(server);");
  });

  it("工具加载不占用工具按钮，完成后不强制重新展开", () => {
    expect(viewSource).toContain("{toolsBusy ? <span className=\"muted shrink-0\"><LoadingSpinner /></span> : null}");
    expect(viewSource).not.toContain("{toolsBusy ? <MetaChip><LoadingSpinner /></MetaChip> : null}");
    expect(viewSource).toContain("<McpToolsPanel result={result} pending={toolsBusy || !toolsLoaded} />");
    // 工具还在取的时候不下"服务端没有返回工具"的结论：那一刻的 result 是连通探测留下的空壳
    expect(viewSource).toContain("!result.tools.length && !pending");
    expect(viewSource).not.toContain("{loading ? <div className=\"grid place-items-center py-2\"><LoadingSpinner /></div>");
    expect(viewSource).not.toContain("disabled={toolsBusy}");
    expect(viewSource).toContain("if (toolsLoading[name])");
  });

  it.each([false, true, null])("服务器 enabled=%s 时，测试和工具按钮同步禁用，编辑仍可用", (enabled) => {
    setupI18n("en-US");
    const markup = renderToStaticMarkup(createElement(McpServerRow, {
      server: {
        name: "fixture", enabled, command: null, args: [], env: {}, url: "https://example.test/mcp",
        startup_timeout_sec: null, tool_timeout_sec: null, bearer_token_env_var: null,
        http_headers: {}, env_http_headers: {},
      },
      result: undefined, probing: false, detailsVisible: false, toolsBusy: true, toolsLoaded: false,
      onEdit: () => {}, onProbe: () => {}, onToggleTools: () => {},
    }));
    const buttons = markup.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons.map((button) => button.includes(' disabled=""')))
      .toEqual([false, enabled === false, enabled === false]);
  });

  it("列表按类型分组（stdio → http → unknown）优先、组内按名称", () => {
    expect(viewSource).toContain("orderedServers.map((server) => (");
    const fixture = [
      { name: "zeta", url: "https://x" },
      { name: "alpha", command: "npx" },
      { name: "mystery" },
      { name: "beta", command: "uvx" },
    ] as unknown as Parameters<typeof compareMcpServers>[0][];
    expect([...fixture].sort(compareMcpServers).map((item) => item.name)).toEqual(["alpha", "beta", "zeta", "mystery"]);
  });
});
