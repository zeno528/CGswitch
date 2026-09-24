import { Eraser } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../../../app/Feedback";

/**
 * 编辑器附属条内 models/auth 的文件操作：状态文字 → 中段插槽 → 清空。
 * 清空只改编辑器草稿文本，落盘仍由底部「保存」统一提交；只读态不渲染清空。
 */
export default function TabFileControls({ kind, editable, disabled, onClear, children }: {
  kind: "models" | "auth";
  editable: boolean;
  disabled: boolean;
  onClear: () => void;
  /** 渲染在状态文字与清空之间（如格式化按钮），保证清空收在附属条最右。 */
  children?: ReactNode;
}) {
  const { t } = useTranslation("profiles");
  const feedback = useFeedback();
  const clear = () => {
    void feedback
      .confirm({
        title: t(kind === "models" ? "edit.clearCatalogTitle" : "edit.clearAuthTitle"),
        description: t(kind === "models" ? "edit.clearCatalogDescription" : "edit.clearAuthDescription"),
        confirmText: t("edit.clearFile"),
        destructive: true,
      })
      .then((confirmed) => {
        if (confirmed) onClear();
      });
  };
  return (
    <>
      {kind === "auth" ? (
        <span className="whitespace-nowrap px-2 muted">{editable ? t("edit.authPillEditable") : t("edit.authPillReadonly")}</span>
      ) : null}
      {children}
      {editable ? (
        <button type="button" className="editor-ghost editor-ghost--danger" disabled={disabled} onClick={clear}>
          <Eraser className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
          <span className="whitespace-nowrap font-medium">{t("edit.clearFile")}</span>
        </button>
      ) : null}
    </>
  );
}
