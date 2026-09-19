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

  it("进入列表只做静默连通性探测，工具按钮才刷新工具", () => {
    expect(viewSource).not.toContain("MCP_STATUS_REFRESH_MS");
    expect(viewSource).toContain("probeServer(server, false, false)");
    expect(viewSource).toContain("probeTools(saved, false, false)");
    expect(viewSource).toContain("api.probeMcpServer(name, true, showLoading)");
  });

  it("MCP 卡片空白处可折叠且不抢占操作控件", () => {
    expect(viewSource).toContain('event.target.closest(\'button, input, code, [role="switch"]\')');
    expect(viewSource).toContain("if (!detailsVisible");
    expect(viewSource).toContain("onToggleTools(server);");
  });

  it("工具加载不占用工具按钮，完成后不强制重新展开", () => {
    expect(viewSource).toContain("{toolsBusy ? <MetaChip><LoadingSpinner /></MetaChip> : null}");
    expect(viewSource).toContain("<McpToolsPanel result={result} />");
    expect(viewSource).not.toContain("{loading ? <div className=\"grid place-items-center py-2\"><LoadingSpinner /></div>");
    expect(viewSource).not.toContain("disabled={toolsBusy}");
    expect(viewSource).toContain("if (toolsLoading[name])");
    expect([...viewSource.matchAll(/if \(open\) setToolsOpen\(\(current\)/g)]).toHaveLength(1);
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
