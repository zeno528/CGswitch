import { useTranslation } from "react-i18next";
import type { EditorDiagnosticSummary } from "../types";

// Codex/Claude 编辑页共用的诊断 chip：编辑器存在解析错误时显示错误数与首错行，点击跳到首个错误。
export function DiagnosticsChip({ diagnostics, onFocusFirst }: { diagnostics: EditorDiagnosticSummary; onFocusFirst: () => void }) {
  const { t } = useTranslation("profiles");
  if (diagnostics.count <= 0) return null;
  return (
    <button type="button" className="mr-auto flex min-w-0 items-center gap-1.5 rounded-lg border border-[var(--danger)]/20 bg-(--danger)/10 px-2.5 py-1 text-xs chip-danger" aria-live="polite" onClick={onFocusFirst}>
      <span className="h-1.5 w-1.5 rounded-full bg-(--danger)" />
      {t("edit.diagnosticsErrors", { count: diagnostics.count })}
      {diagnostics.firstLine !== null ? t("edit.diagnosticsLine", { line: diagnostics.firstLine }) : ""}
    </button>
  );
}
