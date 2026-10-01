import { useTranslation } from "react-i18next";

export function McpSourceLabel({ label, value, initialValue, initialized }: {
  label: string;
  value: string;
  initialValue: string;
  initialized: boolean;
}) {
  const { t } = useTranslation("mcp");
  const dirty = initialized && value.replace(/\r\n/g, "\n") !== initialValue.replace(/\r\n/g, "\n");
  return (
    <div className="field-label flex items-center gap-1.5">
      {label}
      {dirty ? <span className="h-1.5 w-1.5 rounded-full bg-accent" role="img" aria-label={t("edit.unsavedChanges")} title={t("edit.unsavedChanges")} /> : null}
    </div>
  );
}
