import { describe, expect, it } from "vitest";
import { builtinPresets, customCatalogTemplate } from "./presets";

describe("customCatalogTemplate", () => {
  it("follows the Codex catalog schema with parser-required fields", () => {
    // 回归：旧模板用 id/name（Codex 目录格式是 slug），且 base_instructions 与
    // supports_reasoning_summaries 缺失会让 Codex 拒载整个目录文件
    const catalog = JSON.parse(customCatalogTemplate) as { models: Array<Record<string, unknown>> };
    expect(catalog.models.length).toBeGreaterThan(0);
    for (const model of catalog.models) {
      expect(model.slug).toBeTruthy();
      expect(model).toHaveProperty("base_instructions");
      expect(model).toHaveProperty("supports_reasoning_summaries");
      expect(model.id).toBeUndefined();
      expect(model.name).toBeUndefined();
    }
  });

  it("carries the full 21-field set of the official catalogs", () => {
    // 对照 assets/builtin/zhipu-models.json 的字段集（CCswitch 与官方目录每条 21 字段）
    const expected = [
      "slug", "display_name", "description", "default_reasoning_level", "supported_reasoning_levels",
      "shell_type", "visibility", "supported_in_api", "priority", "base_instructions",
      "supports_reasoning_summaries", "default_reasoning_summary", "support_verbosity",
      "apply_patch_tool_type", "truncation_policy", "context_window", "max_context_window",
      "effective_context_window_percent", "supports_parallel_tool_calls",
      "experimental_supported_tools", "input_modalities",
    ];
    const catalog = JSON.parse(customCatalogTemplate) as { models: Array<Record<string, unknown>> };
    for (const field of expected) {
      expect(catalog.models[0]).toHaveProperty(field);
    }
  });
});
import { balanceChipClass } from "./presets";

describe("balanceChipClass", () => {
  it("marks a negative balance as danger when usage is unavailable", () => {
    expect(balanceChipClass(null, false, "-1.00")).toBe("chip-danger");
  });

  it("keeps zero and positive balances successful", () => {
    expect(balanceChipClass(null, false, "0.00")).toBe("chip-success");
    expect(balanceChipClass(null, false, "110.00")).toBe("chip-success");
  });

  it("uses usage thresholds before the total balance", () => {
    expect(balanceChipClass(70, false, "110.00")).toBe("chip-warn");
    expect(balanceChipClass(90, false, "110.00")).toBe("chip-danger");
  });
});

describe("builtinPresets 新增 responses 供应商", () => {
  it("内置 kimi / qwen / hunyuan / doubao 四条预设且 base_url 为官方端点", () => {
    const expected: Record<string, string> = {
      kimi: "https://api.moonshot.cn/v1",
      qwen: "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
      hunyuan: "https://tokenhub.tencentmaas.com/v1",
      doubao: "https://ark.cn-beijing.volces.com/api/coding/v3",
    };
    for (const [kind, base] of Object.entries(expected)) {
      const preset = builtinPresets.find((p) => p.kind === kind);
      expect(preset, `缺少内置预设 ${kind}`).toBeDefined();
      expect(preset?.base_url).toBe(base);
      expect(preset?.model).toBeTruthy();
    }
  });
});
