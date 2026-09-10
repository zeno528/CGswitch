import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import { api } from "../../api";
import { useFeedback } from "../../app/Feedback";
import { AppDialog } from "../../components/AppDialog";
import { releaseNotesUrl, useAppUpdate } from "./AppUpdateProvider";

// 与 SkillsView 一致：markdown 渲染懒加载，不进主 bundle
const MarkdownPreview = lazy(() => import("react-markdown"));

interface UpdateNotesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 确认式更新弹窗：先展示本次版本更新日志，用户在弹窗内确认后才下载安装。 */
export function UpdateNotesDialog({ open, onOpenChange }: UpdateNotesDialogProps) {
  const { update, installing, install } = useAppUpdate();
  const feedback = useFeedback();
  const { t } = useTranslation("updates");
  if (!update) return null;
  const openOnGithub = () => {
    void api.openUrl(releaseNotesUrl(update.version)).catch((error) => feedback.error(String(error)));
  };
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t("notice.title", { version: update.version })}
      footer={
        <>
          <button type="button" className="apple-action-button" title={t("notice.openOnGithub")} onClick={openOnGithub}>
            {t("notice.changelog")}
          </button>
          <button type="button" className="apple-action-button app-button--primary" disabled={installing} onClick={() => void install()}>
            {installing ? <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={2} aria-hidden="true" /> : null}
            {installing ? t("notice.installing") : t("notice.updateNow")}
          </button>
        </>
      }
    >
      <Suspense fallback={<div className="grid place-items-center py-8"><LoaderCircle className="h-4 w-4 animate-spin text-[var(--text-secondary)]" strokeWidth={2} aria-hidden="true" /></div>}>
        <div className="skill-markdown-preview max-h-[60vh] overflow-auto">
          {update.notes ? <MarkdownPreview>{update.notes}</MarkdownPreview> : <p className="muted">{t("notice.noNotes")}</p>}
        </div>
      </Suspense>
    </AppDialog>
  );
}
