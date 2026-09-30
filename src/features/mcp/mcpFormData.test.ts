import { describe, expect, it } from "vitest";
import { pairsToRecord, patchClaudeMcpForm, readClaudeMcpForm } from "./mcpFormData";

describe("Claude MCP 表单与原生 JSON", () => {
  it("修改 URL 保留原生传输、请求头、毫秒超时和专属字段", () => {
    const text = JSON.stringify({ type: "sse", url: "https://old.example/mcp", headers: { Authorization: "Bearer ${TOKEN}" }, timeout: 30000, headersHelper: "helper", custom: { keep: true } });
    const form = readClaudeMcpForm(text);
    expect(form.transport).toBe("sse");
    expect(form.timeout).toBe(30000);
    const next = JSON.parse(patchClaudeMcpForm(text, { ...form, url: "https://new.example/mcp" }, "url"));
    expect(next).toEqual({ ...JSON.parse(text), url: "https://new.example/mcp" });
  });

  it("JSON 修改反映到表单，表单修改只更新被编辑的字段", () => {
    const text = JSON.stringify({ command: "runner", args: ["--arg", " spaced "], env: { KEY: " value " }, custom: true });
    const form = readClaudeMcpForm(text);
    expect(form.argsText).toBe("--arg\n spaced ");
    expect(form.envPairs).toEqual([{ key: "KEY", value: " value " }]);
    expect(JSON.parse(patchClaudeMcpForm(text, { ...form, command: "new-runner" }, "command"))).toEqual({ ...JSON.parse(text), command: "new-runner" });
    expect(readClaudeMcpForm('{"type":"http","url":"https://example.test","timeout":60000}').timeout).toBe(60000);
  });

  it("切换传输移除冲突的连接字段，保留专属字段和超时", () => {
    const text = '{"type":"stdio","command":"runner","args":["-y"],"env":{"KEY":"value"},"timeout":30000,"custom":true}';
    const http = patchClaudeMcpForm(text, { ...readClaudeMcpForm(text), transport: "http", url: "https://example.test" }, "transport");
    expect(JSON.parse(http)).toEqual({ type: "http", url: "https://example.test", timeout: 30000, custom: true });
    const stdio = patchClaudeMcpForm(http, { ...readClaudeMcpForm(http), transport: "stdio", command: "runner" }, "transport");
    expect(JSON.parse(stdio)).toEqual({ type: "stdio", command: "runner", timeout: 30000, custom: true });
    expect(JSON.parse(patchClaudeMcpForm(stdio, { ...readClaudeMcpForm(stdio), timeout: null }, "timeout"))).not.toHaveProperty("timeout");
  });

  it("非法 JSON 或字段类型不覆盖表单，键值编辑可清空并安全保留特殊键", () => {
    for (const text of ["{", "null", "[]", '{"command":42}', '{"args":[1]}', '{"env":{"KEY":1}}', '{"headers":[]}', '{"timeout":"30000"}']) {
      expect(() => readClaudeMcpForm(text)).toThrow();
    }
    expect(pairsToRecord([{ key: "__proto__", value: "value" }, { key: " ", value: "ignored" }])).toEqual(JSON.parse('{"__proto__":"value"}'));
    const text = '{"command":"runner","env":{"KEY":"value"},"custom":true}';
    expect(JSON.parse(patchClaudeMcpForm(text, { ...readClaudeMcpForm(text), envPairs: [] }, "envPairs"))).toEqual({ command: "runner", custom: true });
    const args = patchClaudeMcpForm(text, { ...readClaudeMcpForm(text), argsText: "-y\n--port\n8080" }, "argsText");
    expect(readClaudeMcpForm(args).argsText).toBe("-y\n--port\n8080");
    const http = '{"type":"http","url":"https://example.test","headers":{"Old":"value"},"custom":true}';
    const headers = patchClaudeMcpForm(http, { ...readClaudeMcpForm(http), headerPairs: [{ key: "Authorization", value: "Bearer ${TOKEN}" }] }, "headerPairs");
    expect(JSON.parse(headers).headers).toEqual({ Authorization: "Bearer ${TOKEN}" });
    expect(JSON.parse(headers).custom).toBe(true);
  });
});
