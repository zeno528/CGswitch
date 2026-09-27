import { CircleQuestionMark, type LucideIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface AppTooltipProps {
  label: string;
  children: ReactNode;
  icon?: LucideIcon;
}

export function tooltipPosition(trigger: Pick<DOMRect, "left" | "top" | "bottom">, panel: { width: number; height: number }, viewport: { width: number; height: number }) {
  const gap = 8;
  return {
    left: Math.max(gap, Math.min(trigger.left, viewport.width - panel.width - gap)),
    top: trigger.bottom + gap + panel.height <= viewport.height
      ? trigger.bottom + gap
      : Math.max(gap, trigger.top - panel.height - gap),
  };
}

/** 与 MCP 差异说明同款的悬停卡片；Portal 避免被卡片的 overflow: hidden 裁切。 */
export function AppTooltip({ label, children, icon: Icon = CircleQuestionMark }: AppTooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const open = hovered || focused;

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = triggerRef.current?.getBoundingClientRect();
      const panel = panelRef.current;
      if (!trigger || !panel) return;
      setPosition(tooltipPosition(trigger, { width: panel.offsetWidth, height: panel.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }));
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  return <>
    <button
      ref={triggerRef}
      type="button"
      className="grid h-6 w-6 shrink-0 cursor-help place-items-center text-(--text-secondary) transition-colors hover:text-accent focus:text-accent"
      title=""
      aria-label={label}
      aria-describedby={open ? id : undefined}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onClick={(event) => { event.currentTarget.blur(); event.stopPropagation(); }}
    >
      <Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
    </button>
    {open && typeof document !== "undefined" ? createPortal(
      <div
        ref={panelRef}
        id={id}
        role="tooltip"
        className="pointer-events-none fixed z-50 w-80 max-w-[calc(100vw-1rem)] space-y-1.5 rounded-[var(--radius-control)] border border-(--panel-border) bg-(--panel-bg) p-3 shadow-lg"
        style={position ?? { visibility: "hidden" }}
      >{children}</div>,
      document.body,
    ) : null}
  </>;
}
