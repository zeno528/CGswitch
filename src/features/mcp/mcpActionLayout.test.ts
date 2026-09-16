// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

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
    expect(viewSource).toContain("api.probeMcpServer(name, true)");
  });
});
