import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";

/** 菜单展示高度封顶（20rem），须与 style.css 里 .app-select-menu 的 max-height 保持一致。 */
const MENU_MAX_HEIGHT = 320;

interface SelectOption<T extends string | number = string> {
  label: string;
  value: T;
}

interface AppSelectProps<T extends string | number> {
  value: T | null | undefined;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  renderLabel?: (option: SelectOption<T>) => ReactNode;
}

export function AppSelect<T extends string | number>({
  value,
  options,
  onChange,
  placeholder,
  disabled,
  className = "",
  renderLabel,
}: AppSelectProps<T>) {
  const selected = options.find((option) => String(option.value) === String(value));
  const hasOptions = options.length > 0;
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<"bottom" | "top">("bottom");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const updatePosition = () => {
      const root = rootRef.current;
      const menu = menuRef.current;
      if (!root || !menu) return;
      const rect = root.getBoundingClientRect();
      const gap = 6;
      const menuHeight = menu.scrollHeight;
      const below = window.innerHeight - rect.bottom - gap;
      const above = rect.top - gap;
      // 翻转判定用实际会展示的高度（CSS max-height 封顶后的值），而不是内容
      // 完整高度 scrollHeight：后者会高估需求，导致下方空间明明够却向上翻转
      const effectiveHeight = Math.min(menuHeight, MENU_MAX_HEIGHT);
      const nextPlacement = below < effectiveHeight && above > below ? "top" : "bottom";
      setPlacement(nextPlacement);
      setMenuStyle({
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        ...(nextPlacement === "top" ? { top: "auto", bottom: `${window.innerHeight - rect.top + gap}px` } : { top: `${rect.bottom + gap}px`, bottom: "auto" }),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("resize", updatePosition);
    };
  }, [open, options.length]);

  // 展开期间的背景滚动控制：
  // 1. 菜单外发生滚动（容器滚轮/拖动）→ 直接收起，避免 fixed 菜单跟随触发器跳跑
  useEffect(() => {
    if (!open) return;
    const onBackgroundScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", onBackgroundScroll, true);
    return () => window.removeEventListener("scroll", onBackgroundScroll, true);
  }, [open]);

  // 2. 菜单自身的滚轮不穿透：内容不满或已滚到边界时拦下，背景纹丝不动
  //   （React 的 onWheel 是 passive 的，preventDefault 必须用原生 non-passive 监听）
  useEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    if (!menu) return;
    const onMenuWheel = (event: WheelEvent) => {
      const { scrollTop, scrollHeight, clientHeight } = menu;
      const canScroll = scrollHeight > clientHeight;
      const atEdge = event.deltaY < 0 ? scrollTop <= 0 : scrollTop + clientHeight >= scrollHeight;
      if (!canScroll || atEdge) event.preventDefault();
    };
    menu.addEventListener("wheel", onMenuWheel, { passive: false });
    return () => menu.removeEventListener("wheel", onMenuWheel);
  }, [open]);

  const selectOption = (option: SelectOption<T>) => {
    onChange(option.value);
    setOpen(false);
  };

  const menu = (
    <div ref={menuRef} className="app-select-menu" data-open={open} data-placement={placement} style={menuStyle} role="listbox" aria-label={placeholder ?? "选项"} aria-hidden={!open}>
      {options.map((option) => <button
        key={String(option.value)}
        type="button"
        role="option"
        tabIndex={open ? 0 : -1}
        aria-selected={selected?.value === option.value}
        className="app-select-option"
        data-selected={selected?.value === option.value}
        onClick={() => selectOption(option)}
      >
        <span>{renderLabel?.(option) ?? option.label}</span>
        {selected?.value === option.value ? <Check className="app-select-option__check" size={16} strokeWidth={2.5} aria-hidden="true" /> : null}
      </button>)}
    </div>
  );

  return (
    <div ref={rootRef} className="app-select-wrap" data-open={open}>
      <button
        type="button"
        className={`app-select ${className}`}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={placeholder}
        onClick={() => hasOptions && setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
          if (hasOptions && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <span className="app-select__label">{selected ? renderLabel?.(selected) ?? selected.label : placeholder ?? "请选择"}</span>
        <ChevronDown className="app-select__icon" size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {createPortal(menu, document.body)}
    </div>
  );
}
