import { createInstance } from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { expect, it } from "vitest";
import { codexEffortLevels, isOverEffortThumb, ReasoningEffortSlider } from "./ReasoningEffortSlider";

it("只有圆形滑块命中悬停，轨道与滑块外接矩形的角落不命中", () => {
  const rect = { left: 100, top: 20, width: 26, height: 26 };
  expect(isOverEffortThumb(rect, 113, 33)).toBe(true);
  expect(isOverEffortThumb(rect, 126, 33)).toBe(true);
  expect(isOverEffortThumb(rect, 150, 33)).toBe(false);
  expect(isOverEffortThumb(rect, 100, 20)).toBe(false);
});

it("快速模式只隐藏已滑过的等级圆点，未滑到的圆点与原生滑块保留", () => {
  const i18n = createInstance();
  void i18n.init({ lng: "en", resources: { en: { profiles: {} } }, initAsync: false });
  const render = (fast: boolean, value = "high", disabled = false) => renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <ReasoningEffortSlider value={value} levels={["low", "high", "max"]} fast={fast} disabled={disabled} onChange={() => {}} />
    </I18nextProvider>,
  );
  const normal = render(false);
  expect(normal).not.toContain('class="reasoning-effort-slider__particles"');
  const fast = render(true);
  expect(fast.match(/class="reasoning-effort-slider__particles"/g)).toHaveLength(1);
  expect(fast.match(/class="reasoning-effort-slider__stop"/g)).toHaveLength(1);
  expect(fast).toContain('title="max" aria-pressed="false" data-filled="false"');
  expect(fast).not.toContain('title="low"');
  expect(fast).not.toContain('title="high"');
  expect(render(true, "low").match(/class="reasoning-effort-slider__stop"/g)).toHaveLength(2);
  expect(render(true, "max")).not.toContain('class="reasoning-effort-slider__stop"');
  expect(fast).toMatch(/<input[^>]*type="range"[^>]*max="2"[^>]*value="1"/);
  expect(normal.match(/class="reasoning-effort-slider__stop"/g)).toHaveLength(3);
  expect(normal).toContain('title="high" aria-pressed="true"');
  expect(normal).toContain('title="low" aria-pressed="false" data-filled="true"');
  expect(normal).toContain('title="max" aria-pressed="false" data-filled="false"');
  expect(normal).toMatch(/<input[^>]*type="range"[^>]*max="2"[^>]*value="1"/);
  for (const value of codexEffortLevels) {
    const markup = render(false, value);
    expect(markup).toContain(`--effort-color:var(${value === "ultra" ? "--reasoning-ultra" : "--accent"})`);
    expect(render(true, value)).toContain(`--effort-particle-duration:${value === "ultra" ? "0.5s" : "1s"}`);
  }
  expect(render(false, "")).toContain("--effort-color:var(--text-secondary)");
  const pendingInput = render(false, "high", true).match(/<input[^>]*>/)?.[0];
  expect(pendingInput).toContain('aria-disabled="true"');
  expect(pendingInput).not.toContain(' disabled=""');
});
