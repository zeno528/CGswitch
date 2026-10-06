import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../api";
import { webInvoke } from "../../api/web-mock";
import { setupI18n } from "../../i18n";
import type { CodexProfileDetail, CodexProfileSummary } from "../../types";
import type { ModelSelectionOptions } from "../profiles/ProfileModelSelector";
import CodexProfileCard from "./CodexProfileCard";

const loader = vi.hoisted(() => ({ current: null as ((refresh?: boolean) => Promise<ModelSelectionOptions>) | null }));
vi.mock("../../app/Feedback", () => ({ useFeedback: () => ({ error: vi.fn() }) }));
vi.mock("../profiles/useProfileBalance", () => ({ useProfileBalance: () => ({ balanceInfos: [], refreshBalance: () => {} }) }));
vi.mock("../../components/SortableCard", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("../profiles/ProfileModelSelector", () => ({ default: ({ onLoad }: { onLoad: typeof loader.current }) => {
  loader.current = onLoad;
  return null;
} }));
afterEach(() => vi.restoreAllMocks());

it("官方卡片打开和恢复默认都使用自定义目录，无需访问远程接口或写入远程缓存", async () => {
  setupI18n("zh-CN");
  const profile = await webInvoke<CodexProfileSummary>("codex_add_builtin_profile", { kind: "chatgpt" });
  try {
    const detail = await webInvoke<CodexProfileDetail>("codex_get_profile", { id: profile.id });
    detail.model_values.model_catalog_json = '"models.json"';
    detail.raw_catalog = JSON.stringify({ models: [{ slug: "local", default_reasoning_level: "low",
      supported_reasoning_levels: [{ effort: "low" }] }] });
    detail.fetched_models = ["remote"];
    vi.spyOn(api, "codexGetProfile").mockResolvedValue(detail);
    const fetch = vi.spyOn(api, "codexFetchChatgptModels").mockRejectedValue(new Error("offline"));
    const persist = vi.spyOn(api, "codexSetProfileFetchedModels").mockResolvedValue();
    renderToStaticMarkup(createElement(CodexProfileCard, { profile, active: false, busy: false,
      activationEpoch: 0, coldStart: false, onApply: () => {}, onRename: () => {}, onEdit: () => {},
      onRemove: () => {}, onDuplicate: () => {}, onChanged: async () => {} }));
    for (const refresh of [false, true]) {
      expect(await loader.current!(refresh)).toMatchObject({ models: ["local"], efforts: { local: ["low"] }, defaults: { local: "low" } });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  } finally { await webInvoke("codex_delete_profile", { id: profile.id }); }
});
