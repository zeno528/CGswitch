import { describe, expect, it } from "vitest";
import { tooltipPosition } from "./AppTooltip";

describe("tooltipPosition", () => {
  it("stays inside the viewport and flips above a bottom-edge trigger", () => {
    expect(tooltipPosition({ left: 760, top: 550, bottom: 574 }, { width: 320, height: 120 }, { width: 800, height: 600 })).toEqual({ left: 472, top: 422 });
    expect(tooltipPosition({ left: 20, top: 20, bottom: 44 }, { width: 320, height: 120 }, { width: 800, height: 600 })).toEqual({ left: 20, top: 52 });
  });
});
