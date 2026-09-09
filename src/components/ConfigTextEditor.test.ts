import packageJson from "../../package.json";
import profileEditSource from "../features/profiles/ProfileEdit.tsx?raw";
import editorSource from "./ConfigTextEditor.tsx?raw";
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { collectJsonDiagnostics } from "./ConfigTextEditor";

describe("ConfigTextEditor runtime", () => {
  it("uses the native CodeMirror runtime instead of a duplicate wrapper runtime", () => {
    const dependencies = packageJson.dependencies as Record<string, string>;
    expect(dependencies["@uiw/react-codemirror"]).toBeUndefined();
    expect(dependencies.codemirror).toBeUndefined();
    expect(dependencies["@codemirror/state"]).toBeDefined();
    expect(dependencies["@codemirror/view"]).toBeDefined();
  });

  it("binds diagnostic focus to every profile editor variant", () => {
    expect(profileEditSource.match(/<ConfigTextEditor[^>]*ref=\{editorRef\}/g)).toHaveLength(3);
  });

  it("gates JSON diagnostics behind JSON.parse", () => {
    expect(editorSource).toContain("JSON.parse(text)");
  });

  it("keeps the horizontal scrollbar outside the line-number gutter", () => {
    expect(editorSource).toContain('className="cm-horizontal-scrollbar-row"');
    expect(editorSource).toContain('className="cm-horizontal-scrollbar-gutter"');
    expect(editorSource).toContain('className="cm-horizontal-scrollbar"');
    expect(editorSource).toContain("editor.scrollDOM.scrollLeft = scrollbar.scrollLeft");
    expect(editorSource.indexOf('<div ref={hostRef} />')).toBeLessThan(editorSource.indexOf('className="cm-horizontal-scrollbar-row"'));
    expect(editorSource).toContain("const previousScrollTop = editor.scrollDOM.scrollTop");
    expect(editorSource).toContain("editor.scrollDOM.scrollTop = previousScrollTop");
  });
});

describe("collectJsonDiagnostics", () => {
  const stateOf = (doc: string) => EditorState.create({ doc });

  it("valid JSON never reports errors, even with huge single-line strings", () => {
    // 真实回归样本：模型目录里 4 万字符的超长 base_instructions 曾被语法树误报
    const catalog = JSON.stringify({
      models: [{ slug: "deepseek-v4-flash", base_instructions: "You are Codex. ".repeat(2800) }],
    });
    expect(collectJsonDiagnostics(stateOf(catalog))).toEqual([]);
  });

  it("blank documents report nothing", () => {
    expect(collectJsonDiagnostics(stateOf("   \n  "))).toEqual([]);
  });
});
