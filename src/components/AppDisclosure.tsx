import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

interface AppDisclosureProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: ReactNode;
  children: ReactNode;
  className?: string;
  showIcon?: boolean;
  iconPosition?: "start" | "end";
}

export function AppDisclosure({ open, onOpenChange, summary, children, className = "", showIcon = true, iconPosition = "end" }: AppDisclosureProps) {
  const icon = showIcon ? <ChevronRight className={`apple-disclosure__icon ${iconPosition === "end" ? "ml-auto" : ""}`} size={18} strokeWidth={2} aria-hidden="true" /> : null;
  return (
    <div className={`apple-disclosure ${open ? "apple-disclosure--open" : ""} ${className}`.trim()}>
      <button type="button" className="apple-disclosure__summary" aria-expanded={open} onClick={() => onOpenChange(!open)}>
        {iconPosition === "start" ? icon : null}
        {summary}
        {iconPosition === "end" ? icon : null}
      </button>
      <div className="apple-disclosure__content" aria-hidden={!open} inert={!open}>
        <div className="apple-disclosure__body">{children}</div>
      </div>
    </div>
  );
}
