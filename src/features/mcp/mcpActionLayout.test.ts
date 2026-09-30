// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareMcpServers } from "./McpView";

const viewSource = readFileSync(new URL("./McpView.tsx", import.meta.url), "utf8");
const editSource = readFileSync(new URL("./McpEdit.tsx", import.meta.url), "utf8");

describe("MCP 操作入口", () => {
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

  it("只在编辑器外响应回车，且不再要求 Ctrl", () => {
    expect(editSource).toContain('event.key === "Enter" && !event.nativeEvent.isComposing && !(event.target instanceof Element && event.target.closest(".apple-editor-shell"))');
    expect(editSource).not.toContain('event.ctrlKey && event.key === "Enter"');
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

  it("禁用的服务器同步禁用测试连通按钮（后端 probe 对禁用条目直接报错）", () => {
    expect(viewSource).toContain("disabled={probing || server.enabled === false}");
    expect(viewSource).toContain("list.testConnectionDisabled");
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
