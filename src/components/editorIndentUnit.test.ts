import { describe, expect, it } from "vitest";
import { detectIndentUnit, indentGuideLayout } from "./editorIndentUnit";

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

describe("indentGuideLayout", () => {
  it("places one marker at each ancestor boundary for complete and partial indentation", () => {
    expect(indentGuideLayout('        "nested": 1', "    ").markEnds).toEqual([4]);
    expect(indentGuideLayout('              "partial": 1', "    ").markEnds).toEqual([4, 8, 12]);
  });

  it("does not draw the first indent level or guides beyond the text", () => {
    expect(indentGuideLayout('    "value": 1', "    ").markEnds).toEqual([]);
    expect(indentGuideLayout('  "value": 1', "    ").markEnds).toEqual([]);
  });

  it("counts tab stops and fills inherited guides on blank lines", () => {
    expect(indentGuideLayout('\t\t"value": 1', "\t").markEnds).toEqual([1]);
    expect(indentGuideLayout("  ", "    ", 4, 2)).toEqual({ markEnds: [], fillSegments: [2, 4] });
  });
});
