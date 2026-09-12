import packageJson from "../../package.json";
import profileEditSource from "../features/profiles/ProfileEdit.tsx?raw";
import editorSource from "./ConfigTextEditor.tsx?raw";
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { collectJsonDiagnostics, computeTextChange } from "./ConfigTextEditor";

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

  it("only synchronizes the changed config fragment", () => {
    const current = 'model = "gpt-5.6"\nmodel_reasoning_effort = "medium"\n[features]\n';
    const next = `${current}respect_system_proxy = true\n`;
    expect(computeTextChange(current, next)).toEqual({
      from: current.length,
      to: current.length,
      insert: "respect_system_proxy = true\n",
    });
    expect(editorSource).toContain("editor.dispatch({ changes: computeTextChange(editor.state.doc.toString(), value) });");
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

  it("用错误行高亮和红色粗体行号替代独立错误 gutter", () => {
    expect(editorSource).not.toContain("lintGutter()");
    expect(editorSource).toContain("setDiagnosticsEffect");
    expect(editorSource).toContain("gutterLineClass");
    expect(editorSource).toContain("value.gutters.map(transaction.changes)");
    expect(editorSource).toContain("cm-diagnostic-error-line");
    expect(editorSource).toContain("cm-diagnostic-error-gutter");
  });
});

describe("collectJsonDiagnostics", () => {
  const stateOf = (doc: string) => EditorState.create({ doc });

  it("valid JSON never reports errors, even with huge single-line strings", () => {
    // 真实回归样本：模型目录里 4 万字符的超长 base_instructions 曾被语法树误报
    const catalog = JSON.stringify({
      models: [{ slug: "deepseek-flash", base_instructions: "You are Codex. ".repeat(2800) }],
    });
    expect(collectJsonDiagnostics(stateOf(catalog))).toEqual([]);
  });

  it("blank documents report nothing", () => {
    expect(collectJsonDiagnostics(stateOf("   \n  "))).toEqual([]);
  });
});
