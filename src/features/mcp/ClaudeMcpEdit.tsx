import { ArrowLeft, CodeXml, Save } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import ConfigTextEditor, { type ConfigTextEditorHandle } from "../../components/ConfigTextEditor";
import { TrashIcon } from "../../components/TrashIcon";
import type { EditorDiagnosticSummary, McpServerSpec } from "../../types";

interface ClaudeMcpEditProps {
  server: McpServerSpec | null;
  create?: boolean;
  onBack: () => void;
  onSaved: (name: string) => void;
  onDelete?: () => Promise<void>;
}

export default function ClaudeMcpEdit({ server, create = false, onBack, onSaved, onDelete }: ClaudeMcpEditProps) {
  const feedback = useFeedback();
  const { t } = useTranslation("mcp");
  const [name, setName] = useState(server?.name ?? "");
  const [jsonText, setJsonText] = useState("{\n  \"type\": \"stdio\",\n  \"command\": \"\"\n}");
  const [initialized, setInitialized] = useState(create);
  const [saving, setSaving] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [diagnostics, setDiagnostics] = useState<EditorDiagnosticSummary>({ count: 0, firstLine: null });
  const editorRef = useRef<ConfigTextEditorHandle>(null);

  useEffect(() => {
    if (create || !server) return;
    let cancelled = false;
    void api.getClaudeMcpServerJson(server.name).then((value) => {
      if (cancelled) return;
      if (value) setJsonText(value);
      setInitialized(true);
    }).catch((error) => feedback.error(String(error)));
    return () => { cancelled = true; };
  }, [create, feedback, server]);

  const formatJson = () => {
    if (formatting || saving) return;
    setFormatting(true);
    try {
      setJsonText(`${JSON.stringify(JSON.parse(jsonText), null, 2)}\n`);
      feedback.success(t("claude.formatted"));
    } catch (error) {
      feedback.error(t("claude.formatFailed", { error: String(error) }));
    } finally {
      setFormatting(false);
    }
  };

  const save = async () => {
    if (saving || !initialized) return;
    const trimmedName = name.trim();
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(trimmedName)) {
      feedback.error(t("claude.invalidName"));
      return;
    }
    try {
      JSON.parse(jsonText);
    } catch {
      feedback.error(t("claude.invalidJson"));
      editorRef.current?.focusFirstDiagnostic();
      return;
    }
    setSaving(true);
    try {
      await api.saveClaudeMcpServer(server?.name ?? null, trimmedName, jsonText);
      feedback.success(t("claude.saved"));
      onSaved(trimmedName);
    } catch (error) {
      feedback.error(String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="apple-edit-page mx-auto flex w-full max-w-none flex-col" onKeyDown={(event) => {
      if (event.key === "Enter" && !event.nativeEvent.isComposing && !(event.target instanceof Element && event.target.closest(".apple-editor-shell"))) {
        event.preventDefault();
        void save();
      }
    }}>
      <div className="apple-page-bar apple-page-bar--roomy apple-edit-toolbar apple-edit-toolbar--header justify-between">
        <button type="button" className="apple-page-header apple-back-button" aria-label={t("claude.back")} onClick={onBack}>
          <ArrowLeft className="h-4 w-4 shrink-0 text-accent" strokeWidth={2} aria-hidden="true" />
          <span className="apple-title">{create ? t("claude.createTitle") : t("claude.editTitle")}</span>
        </button>
        {!create && onDelete ? <button type="button" className="apple-action-button app-button--danger" disabled={saving} onClick={() => void onDelete()}><TrashIcon />{t("claude.delete")}</button> : null}
      </div>
      <div className="apple-edit-content">
        <div className="apple-group p-0">
          <div className="apple-panel-section">
            <div className="field-label mb-1.5">{t("claude.name")}</div>
            <input className="app-input mono" maxLength={64} placeholder={t("claude.namePlaceholder")} value={name} onChange={(event) => setName(event.target.value)} />
            <p className="field-subtitle mt-2">{t("claude.source")}</p>
          </div>
          <div className="apple-panel-section">
            <div className="mb-1.5 flex min-h-8 items-center justify-between gap-2">
              <div className="field-label">{t("claude.jsonSource")}</div>
              <button type="button" className="editor-ghost editor-ghost--format shrink-0" disabled={formatting || saving || !initialized} onClick={formatJson}>
                <CodeXml className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                <span className="whitespace-nowrap font-medium">{t("claude.format")}</span>
              </button>
            </div>
            <ConfigTextEditor ref={editorRef} value={jsonText} language="json" minLines={12} readOnly={!initialized} placeholder={t("claude.jsonPlaceholder")} onChange={setJsonText} onDiagnostics={setDiagnostics} />
            {diagnostics.count > 0 ? <p className="mt-2 text-xs chip-danger">{diagnostics.count} JSON error{diagnostics.count === 1 ? "" : "s"}</p> : null}
          </div>
        </div>
      </div>
      <div className="apple-edit-toolbar apple-edit-toolbar--footer">
        <button type="button" className="apple-action-button" onClick={onBack}>{t("claude.cancel")}</button>
        <button type="button" className="apple-action-button app-button--primary" disabled={saving || !initialized} onClick={() => void save()}><Save className="h-4 w-4" strokeWidth={2} />{saving ? t("claude.saving") : t("claude.save")}</button>
      </div>
    </section>
  );
}
