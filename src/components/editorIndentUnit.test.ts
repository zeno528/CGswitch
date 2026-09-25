import { describe, expect, it } from "vitest";
import { detectIndentUnit, indentGuideShiftCh } from "./editorIndentUnit";

describe("detectIndentUnit", () => {
  it("detects 2-space indentation", () => {
    expect(detectIndentUnit('{\n  "a": [\n    "b"\n  ]\n}')).toBe("  ");
  });

  it("detects 4-space indentation", () => {
    expect(detectIndentUnit('{\n    "a": [\n        "b"\n    ]\n}')).toBe("    ");
  });

  it("prefers tabs when any line starts with one", () => {
    expect(detectIndentUnit("{\n\t\"a\": 1\n}")).toBe("\t");
  });

  it("falls back to 2 spaces for flat or empty documents", () => {
    expect(detectIndentUnit("")).toBe("  ");
    expect(detectIndentUnit("a = 1\nb = 2\n")).toBe("  ");
  });

  it("uses the smallest indent among indented lines", () => {
    expect(detectIndentUnit('{\n  "a": {\n      "b": 1\n  }\n}')).toBe("  ");
  });
});

describe("indentGuideShiftCh", () => {
  it("shifts the package grid so guides land on text columns", () => {
    expect(indentGuideShiftCh("  ")).toBe(1.5);
    expect(indentGuideShiftCh("    ")).toBe(3.5);
    expect(indentGuideShiftCh("\t")).toBe(3.5);
  });
});
