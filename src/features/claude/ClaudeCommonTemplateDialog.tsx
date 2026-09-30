import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { AppDialog } from "../../components/AppDialog";
import ConfigTextEditor from "../../components/ConfigTextEditor";
import { extractClaudeCommonSettings } from "./profileEnvText";

/** 列表管理与编辑页提取共用；只在打开时读取模板。 */
export default function ClaudeCommonTemplateDialog({ sourceText, onClose }: {
  sourceText?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation("claude");
  const { t: tProfiles } = useTranslation("profiles");
  const feedback = useFeedback();
  const [text, setText] = useState("{}");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [diagnostics, setDiagnostics] = useState({ count: 0, firstLine: null as number | null });

  useEffect(() => {
    let cancelled = false;
    void api.claudeGetCommonSettings().then((saved) => {
      if (!cancelled) {
        setText(saved ?? "{}");
        setLoading(false);
      }
    }).catch((error) => {
      if (!cancelled) {
        feedback.error(String(error));
        onClose();
      }
    });
    return () => { cancelled = true; };
  }, []);

  const extract = () => {
    if (loading || saving || sourceText === undefined) return;
    const common = extractClaudeCommonSettings(sourceText);
    if (common === null) {
      feedback.error(t("envInvalid"));
      return;
    }
    setText(common);
    feedback.success(t("commonTemplate.extracted"));
  };

  const save = async () => {
    if (loading || saving) return;
    const common = extractClaudeCommonSettings(text);
    if (common === null) {
      feedback.error(t("envInvalid"));
      return;
    }
    setSaving(true);
    try {
      await api.claudeSaveCommonSettings(common === "{}" ? null : common);
      feedback.success(t("commonTemplate.saved"));
      onClose();
    } catch (error) {
      feedback.error(String(error));
      setSaving(false);
    }
  };

  return (
    <AppDialog
      open
      onOpenChange={(open) => { if (!open && !saving) onClose(); }}
      title={t("commonTemplate.title")}
      description={t("commonTemplate.description")}
      className="claude-template-dialog"
      footer={(
        <>
          <button type="button" className="apple-action-button app-button--danger mr-auto" disabled={loading || saving} onClick={() => setText("{}")}>{tProfiles("edit.clearFile")}</button>
          {sourceText !== undefined ? (
            <button type="button" className="apple-action-button" disabled={loading || saving} onClick={extract}>{t("commonTemplate.extract")}</button>
          ) : null}
          <button type="button" className="apple-action-button" disabled={saving} onClick={onClose}>{tProfiles("dialog.cancel")}</button>
          <button type="button" className="apple-action-button app-button--primary" disabled={loading || saving || diagnostics.count > 0} onClick={() => void save()}>
            {saving ? tProfiles("edit.saving") : tProfiles("dialog.save")}
          </button>
        </>
      )}
    >
      <ConfigTextEditor value={text} language="json" minLines={12} readOnly={loading || saving} onChange={setText} onDiagnostics={setDiagnostics} />
    </AppDialog>
  );
}
