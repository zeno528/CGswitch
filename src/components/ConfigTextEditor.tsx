import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { history, defaultKeymap, historyKeymap } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, ensureSyntaxTree, foldGutter, foldKeymap, indentOnInput, StreamLanguage, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { json } from "@codemirror/lang-json";
import { forEachDiagnostic, lintKeymap, linter, setDiagnosticsEffect, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, RangeSet, StateField } from "@codemirror/state";
import { crosshairCursor, Decoration, drawSelection, EditorView, gutterLineClass, GutterMarker, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, keymap, lineNumbers, placeholder as editorPlaceholder, rectangularSelection, dropCursor, type ViewUpdate } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import i18next from "i18next";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";
import type { EditorDiagnosticSummary, TomlDiagnostic } from "../types";

const basicSetup = [
  lineNumbers(),
  highlightActiveLineGutter(),
  highlightSpecialChars(),
  history(),
  // Keep the editor's baseline behavior aligned with CodeMirror's public basicSetup.
  // All extensions are imported directly so Vite cannot embed a second state runtime.
  foldGutter(),
  drawSelection(),
  dropCursor(),
  EditorState.allowMultipleSelections.of(true),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  bracketMatching(),
  closeBrackets(),
  autocompletion(),
  rectangularSelection(),
  crosshairCursor(),
  highlightActiveLine(),
  highlightSelectionMatches(),
  keymap.of([
    ...closeBracketsKeymap,
    ...defaultKeymap,
    ...searchKeymap,
    ...historyKeymap,
    ...foldKeymap,
    ...completionKeymap,
    ...lintKeymap,
  ]),
];

const diagnosticErrorGutterMarker = new (class extends GutterMarker {
  elementClass = "cm-diagnostic-error-gutter";
})();

function diagnosticLineDecorations(doc: EditorState["doc"], diagnostics: readonly Diagnostic[]) {
  const lineStarts = [...new Set(diagnostics.filter(({ severity }) => severity === "error").map(({ from }) => doc.lineAt(from).from))];
  return {
    content: Decoration.set(lineStarts.map((from) => Decoration.line({ class: "cm-diagnostic-error-line" }).range(from)), true),
    gutters: RangeSet.of(lineStarts.map((from) => diagnosticErrorGutterMarker.range(from)), true),
  };
}

const diagnosticLineDecorationsField = StateField.define<ReturnType<typeof diagnosticLineDecorations>>({
  create: () => ({ content: Decoration.none, gutters: RangeSet.empty }),
  update(value, transaction) {
    const diagnosticEffect = transaction.effects.find((effect) => effect.is(setDiagnosticsEffect));
    if (diagnosticEffect?.is(setDiagnosticsEffect)) return diagnosticLineDecorations(transaction.state.doc, diagnosticEffect.value);
    return { content: value.content.map(transaction.changes), gutters: value.gutters.map(transaction.changes) };
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.content),
    gutterLineClass.from(field, (value) => value.gutters),
  ],
});

export interface ConfigTextEditorHandle {
  focusFirstDiagnostic: () => void;
}

/**
 * JSON.parse 是唯一裁决：解析通过绝不报错（部分语法树/错误恢复会对合法大文档误报）；
 * 确认损坏后才用 ensureSyntaxTree 取完整语法树定位。
 */
export function collectJsonDiagnostics(state: EditorState): Diagnostic[] {
  const text = state.doc.toString();
  if (!text.trim()) return [];
  try {
    JSON.parse(text);
    return [];
  } catch {
    // 已确认损坏，继续用语法树定位
  }
  const diagnostics: Diagnostic[] = [];
  // 1 秒预算内强制解析完整棵树；超时则退回当前可用的树（文档已确认损坏，只影响定位精度）
  const tree = ensureSyntaxTree(state, state.doc.length, 1000) ?? syntaxTree(state);
  tree.iterate({
    enter(node) {
      if (!node.type.isError) return;
      diagnostics.push({
        from: node.from,
        to: Math.min(state.doc.length, Math.max(node.to, node.from + 1)),
        severity: "error",
        source: "JSON",
        message: i18next.t("editor.jsonSyntaxError"),
      });
    },
  });
  return diagnostics;
}

export function computeTextChange(current: string, next: string) {
  let from = 0;
  while (from < current.length && from < next.length && current.charCodeAt(from) === next.charCodeAt(from)) from += 1;

  let currentTo = current.length;
  let nextTo = next.length;
  while (currentTo > from && nextTo > from && current.charCodeAt(currentTo - 1) === next.charCodeAt(nextTo - 1)) {
    currentTo -= 1;
    nextTo -= 1;
  }

  return { from, to: currentTo, insert: next.slice(from, nextTo) };
}

interface ConfigTextEditorProps {
  value: string;
  language: "toml" | "json";
  placeholder?: string;
  readOnly?: boolean;
  validateToml?: (text: string) => Promise<TomlDiagnostic[]>;
  onChange: (value: string) => void;
  onDiagnostics: (summary: EditorDiagnosticSummary) => void;
}

const ConfigTextEditor = forwardRef<ConfigTextEditorHandle, ConfigTextEditorProps>(function ConfigTextEditor(
  { value, language, placeholder, readOnly = false, validateToml = api.validateToml, onChange, onDiagnostics },
  ref,
) {
  const { t } = useTranslation();
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const hostRef = useRef<HTMLDivElement>(null);
  const horizontalScrollbarRowRef = useRef<HTMLDivElement>(null);
  const horizontalScrollbarGutterRef = useRef<HTMLDivElement>(null);
  const horizontalScrollbarRef = useRef<HTMLDivElement>(null);
  const horizontalScrollbarContentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onDiagnosticsRef = useRef(onDiagnostics);
  const lastSummary = useRef<EditorDiagnosticSummary | null>(null);
  const syncingValueRef = useRef(false);
  const editingCompartment = useRef(new Compartment());

  valueRef.current = value;
  onChangeRef.current = onChange;
  onDiagnosticsRef.current = onDiagnostics;

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useImperativeHandle(ref, () => ({
    focusFirstDiagnostic: () => {
      const view = viewRef.current;
      if (!view) return;
      let firstFrom: number | null = null;
      let firstTo: number | null = null;
      forEachDiagnostic(view.state, (_diagnostic, from, to) => {
        if (firstFrom === null) {
          firstFrom = from;
          firstTo = to;
        }
      });
      if (firstFrom === null || firstTo === null) return;
      view.dispatch({ selection: { anchor: firstFrom, head: firstTo }, scrollIntoView: true });
      view.focus();
    },
  }), []);

  useEffect(() => {
    const parent = hostRef.current;
    const scrollbarRow = horizontalScrollbarRowRef.current;
    const scrollbarGutter = horizontalScrollbarGutterRef.current;
    const scrollbar = horizontalScrollbarRef.current;
    const scrollbarContent = horizontalScrollbarContentRef.current;
    if (!parent || !scrollbarRow || !scrollbarGutter || !scrollbar || !scrollbarContent) return;

    const reportDiagnostics = (view: EditorView) => {
      let count = 0;
      let firstLine: number | null = null;
      forEachDiagnostic(view.state, (_diagnostic, from) => {
        count += 1;
        if (firstLine === null) firstLine = view.state.doc.lineAt(from).number;
      });
      if (lastSummary.current?.count === count && lastSummary.current.firstLine === firstLine) return;
      lastSummary.current = { count, firstLine };
      onDiagnosticsRef.current({ count, firstLine });
    };

    const jsonDiagnostics = linter((view) => collectJsonDiagnostics(view.state));
    const tomlDiagnostics = linter(async (view) => {
      const diagnostics = await validateToml(view.state.doc.toString());
      return diagnostics.map(({ from, to, message }) => ({
        from,
        to,
        severity: "error" as const,
        source: "TOML",
        message,
      }));
    });

    let editor: EditorView;
    let syncingScroll = false;
    let syncFrame = 0;
    const syncHorizontalScrollbar = () => {
      const scroller = editor.scrollDOM;
      const gutters = scroller.querySelector<HTMLElement>(".cm-gutters-before");
      const gutterWidth = gutters?.getBoundingClientRect().width ?? 0;
      const viewportWidth = Math.max(0, scroller.getBoundingClientRect().width - gutterWidth);
      const contentWidth = Math.max(viewportWidth, scroller.scrollWidth - gutterWidth);
      const hasOverflow = scroller.scrollWidth > scroller.clientWidth;
      const maxScrollLeft = hasOverflow ? Math.max(0, contentWidth - viewportWidth) : 0;
      scrollbarGutter.style.width = `${gutterWidth}px`;
      scrollbarGutter.style.backgroundColor = gutters ? getComputedStyle(gutters).backgroundColor : "transparent";
      scrollbarContent.style.width = `${contentWidth}px`;
      scrollbarRow.style.display = hasOverflow ? "flex" : "none";
      scrollbar.scrollLeft = Math.min(scroller.scrollLeft, maxScrollLeft);
      scrollbar.setAttribute("aria-valuemax", String(maxScrollLeft));
      scrollbar.setAttribute("aria-valuenow", String(scroller.scrollLeft));
    };
    const scheduleScrollbarSync = () => {
      cancelAnimationFrame(syncFrame);
      syncFrame = requestAnimationFrame(syncHorizontalScrollbar);
    };
    const onEditorScroll = () => {
      if (syncingScroll) return;
      syncingScroll = true;
      scrollbar.scrollLeft = editor.scrollDOM.scrollLeft;
      scrollbar.setAttribute("aria-valuenow", String(editor.scrollDOM.scrollLeft));
      syncingScroll = false;
    };
    const onScrollbarScroll = () => {
      if (syncingScroll) return;
      syncingScroll = true;
      editor.scrollDOM.scrollLeft = scrollbar.scrollLeft;
      scrollbar.setAttribute("aria-valuenow", String(scrollbar.scrollLeft));
      syncingScroll = false;
    };
    const onEditorWheel = (event: WheelEvent) => {
      const delta = event.deltaX || (event.shiftKey ? event.deltaY : 0);
      if (!delta) return;
      event.preventDefault();
      scrollbar.scrollLeft += delta;
    };

    editor = new EditorView({
      state: EditorState.create({
        doc: valueRef.current,
        extensions: [
          basicSetup,
          editingCompartment.current.of([
            EditorState.readOnly.of(readOnly),
            EditorView.editable.of(!readOnly),
          ]),
          editorPlaceholder(placeholder ?? t("editor.placeholder")),
          language === "toml" ? StreamLanguage.define(toml) : json(),
          language === "toml" ? tomlDiagnostics : jsonDiagnostics,
          diagnosticLineDecorationsField,
          ...(dark ? [oneDark] : []),
          EditorView.updateListener.of((update: ViewUpdate) => {
            if (update.docChanged && !syncingValueRef.current) onChangeRef.current(update.state.doc.toString());
            reportDiagnostics(update.view);
            if (update.docChanged || update.geometryChanged) scheduleScrollbarSync();
          }),
        ],
      }),
      parent,
    });
    viewRef.current = editor;
    editor.scrollDOM.addEventListener("scroll", onEditorScroll);
    editor.scrollDOM.addEventListener("wheel", onEditorWheel, { passive: false });
    scrollbar.addEventListener("scroll", onScrollbarScroll);
    const resizeObserver = new ResizeObserver(scheduleScrollbarSync);
    resizeObserver.observe(editor.dom);
    scheduleScrollbarSync();
    reportDiagnostics(editor);

    return () => {
      cancelAnimationFrame(syncFrame);
      resizeObserver.disconnect();
      editor.scrollDOM.removeEventListener("scroll", onEditorScroll);
      editor.scrollDOM.removeEventListener("wheel", onEditorWheel);
      scrollbar.removeEventListener("scroll", onScrollbarScroll);
      editor.destroy();
      if (viewRef.current === editor) viewRef.current = null;
    };
  }, [dark, language, placeholder, validateToml, t]);

  useEffect(() => {
    const editor = viewRef.current;
    if (!editor) return;
    editor.dispatch({
      effects: editingCompartment.current.reconfigure([
        EditorState.readOnly.of(readOnly),
        EditorView.editable.of(!readOnly),
      ]),
    });
  }, [readOnly]);

  useEffect(() => {
    const editor = viewRef.current;
    if (!editor || editor.state.doc.toString() === value) return;
    const previousScrollTop = editor.scrollDOM.scrollTop;
    const previousScrollLeft = editor.scrollDOM.scrollLeft;
    let restoreFrame = 0;
    const restoreScrollPosition = () => {
      editor.scrollDOM.scrollTop = previousScrollTop;
      editor.scrollDOM.scrollLeft = previousScrollLeft;
    };
    syncingValueRef.current = true;
    try {
      editor.dispatch({ changes: computeTextChange(editor.state.doc.toString(), value) });
      restoreScrollPosition();
      restoreFrame = requestAnimationFrame(restoreScrollPosition);
    } finally {
      syncingValueRef.current = false;
    }
    return () => cancelAnimationFrame(restoreFrame);
  }, [value]);

  return (
    <div className="apple-editor-shell">
      <div ref={hostRef} />
      <div ref={horizontalScrollbarRowRef} className="cm-horizontal-scrollbar-row">
        <div ref={horizontalScrollbarGutterRef} className="cm-horizontal-scrollbar-gutter" aria-hidden="true" />
        <div
          ref={horizontalScrollbarRef}
          className="cm-horizontal-scrollbar"
          role="scrollbar"
          aria-label={t("editor.horizontalScrollbar")}
          aria-orientation="horizontal"
          aria-valuemin={0}
          aria-valuemax={0}
          aria-valuenow={0}
          tabIndex={0}
        >
          <div ref={horizontalScrollbarContentRef} />
        </div>
      </div>
    </div>
  );
});

export default ConfigTextEditor;
