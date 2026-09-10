import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { type ReactNode, type RefObject } from "react";

interface AppDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}

export function AppDialog({ open, onOpenChange, title, description, children, footer, initialFocusRef, className = "" }: AppDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="app-dialog-overlay" />
        <Dialog.Content
          className={`app-dialog-content ${className}`}
          onOpenAutoFocus={(event) => {
            if (!initialFocusRef?.current) return;
            event.preventDefault();
            initialFocusRef.current.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            (document.activeElement as HTMLElement | null)?.blur();
          }}
        >
          <Dialog.Title className="app-dialog-title">{title}</Dialog.Title>
          {description ? <Dialog.Description className="app-dialog-description">{description}</Dialog.Description> : null}
          <div className="app-dialog-body">{children}</div>
          {footer ? <div className="app-dialog-actions">{footer}</div> : null}
          <Dialog.Close aria-label={t("window.close")} className="app-dialog-close">×</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
