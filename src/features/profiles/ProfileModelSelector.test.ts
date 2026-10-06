import { createInstance } from "i18next";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { expect, it, vi } from "vitest";
import { FeedbackProvider } from "../../app/Feedback";
import { setOneMillionModelSuffix } from "../claude/profileEnvText";
import ProfileModelSelector, { selectModel } from "./ProfileModelSelector";

it("切换模型保留可用或未知档位，仅对目录明确不支持的档位恢复默认", () => {
  expect(selectModel("next", "high", ["low", "high"])).toEqual({ model: "next", effort: "high" });
  expect(selectModel("next", "max", ["low", "high"])).toEqual({ model: "next", effort: "" });
  expect(selectModel("next", "future-level")).toEqual({ model: "next", effort: "future-level" });
  expect(selectModel("next", "high", [])).toEqual({ model: "next", effort: "" });
});

it("模型名与快速模式图标直接显示在关闭的配置卡片上，无需读取详情", () => {
  const i18n = createInstance();
  void i18n.init({ lng: "en", resources: { en: { profiles: { modelSelection: { fastMode: "Fast mode" } } } }, initAsync: false });
  const onLoad = vi.fn(async () => ({ model: "fixture", effort: "high", models: [] }));
  const render = (fast: boolean, supportsFastMode = true, model = "fixture", formatModelLabel?: (value: string) => string) => renderToStaticMarkup(
    createElement(I18nextProvider, { i18n }, createElement(FeedbackProvider, {
      children: createElement(ProfileModelSelector, {
        model, effort: "high", levels: ["high"], disabled: false,
        fast, supportsFastMode, formatModelLabel, onLoad, onSave: async () => {},
      }),
    })),
  );
  expect(render(true)).toContain('aria-label="Fast mode"');
  expect(render(true)).toContain('aria-expanded="false"');
  expect(render(false)).not.toContain('aria-label="Fast mode"');
  expect(render(true, false)).not.toContain('aria-label="Fast mode"');
  const claude = render(false, false, "glm-5.3[1m]", (value) => setOneMillionModelSuffix(value, false));
  expect(claude).toContain(">glm-5.3</span>");
  expect(claude).not.toContain("[1m]");
  expect(render(false, false, "fixture[1m]")).toContain(">fixture[1m]</span>");
  expect(onLoad).not.toHaveBeenCalled();
});
