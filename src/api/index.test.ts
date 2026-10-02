// @ts-expect-error 测试运行于 Node，但应用的浏览器 tsconfig 不加载 Node 类型。
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { webInvoke } from "./web-mock";

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

afterEach(() => vi.unstubAllGlobals());

it("获取 Codex 模型列表使用实际注册的 Tauri 命令", async () => {
  const source = readFileSync(new URL("../../src-tauri/src/lib.rs", import.meta.url), "utf8");
  const handler = source.match(/generate_handler!\[([\s\S]*?)\]/)?.[1] ?? "";
  const registered = new Set([...handler.matchAll(/commands::(\w+)/g)].map((match) => match[1]));
  const models = ["fixture-model"];
  mocks.invoke.mockImplementation(async (command: string) => {
    if (!registered.has(command)) throw new Error(`未注册 Tauri 命令：${command}`);
    return models;
  });
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  const { api } = await import("./index");

  expect(await api.codexFetchProviderModels("https://example.test", "fixture-key")).toEqual(models);
  expect(mocks.invoke).toHaveBeenCalledWith("codex_fetch_provider_models", {
    baseUrl: "https://example.test",
    apiKey: "fixture-key",
  });
});

it("浏览器 mock 明确说明模型列表需要在桌面版获取", async () => {
  await expect(webInvoke("codex_fetch_provider_models", {
    baseUrl: "https://example.test",
    apiKey: "fixture-key",
  })).rejects.toThrow("请在桌面版获取供应商模型列表");
});
