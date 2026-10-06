import { expect, it } from "vitest";
import { selectModel } from "./ProfileModelSelector";

it("切换模型保留可用或未知档位，仅对目录明确不支持的档位恢复默认", () => {
  expect(selectModel("next", "high", ["low", "high"])).toEqual({ model: "next", effort: "high" });
  expect(selectModel("next", "max", ["low", "high"])).toEqual({ model: "next", effort: "" });
  expect(selectModel("next", "future-level")).toEqual({ model: "next", effort: "future-level" });
  expect(selectModel("next", "high", [])).toEqual({ model: "next", effort: "" });
});
