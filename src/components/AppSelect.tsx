import { Check, ChevronDown } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useFixedMenuPosition } from "./useFixedMenuPosition";

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
  const { t } = useTranslation();
  const selected = options.find((option) => String(option.value) === String(value));
  const hasOptions = options.length > 0;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  // 定位（向下/向上自适应翻转）与行内 ⋯ 菜单共用同一套逻辑
  const menuStyle = useFixedMenuPosition(open, rootRef.current, menuRef, "match");

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  // 打开时定位到当前选中项：长列表（如模型清单）从头开始滚会让人找不到正在用的模型。
  // 菜单是 fixed 定位，offsetTop 即相对菜单的偏移；把选中项滚到可视区中部，越界时 scrollTop 自动收敛
  useLayoutEffect(() => {
    if (!open) return;
    const menu = menuRef.current;
    const current = menu?.querySelector<HTMLButtonElement>('[data-selected="true"]');
    if (!menu || !current) return;
    menu.scrollTop = Math.max(0, current.offsetTop - (menu.clientHeight - current.offsetHeight) / 2);
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
    <div ref={menuRef} className="app-select-menu" data-open={open} style={menuStyle} role="listbox" aria-label={placeholder ?? t("select.optionsLabel")} aria-hidden={!open}>
      {options.map((option) => <button
        key={String(option.value)}
        type="button"
        role="option"
        tabIndex={open ? 0 : -1}
        aria-selected={selected?.value === option.value}
        className="app-select-option app-selection-state"
        data-active={selected?.value === option.value ? "true" : undefined}
        data-selected={selected?.value === option.value}
        onClick={() => selectOption(option)}
      >
        <span>{renderLabel?.(option) ?? option.label}</span>
        {selected?.value === option.value ? <Check className="app-select-option__check" size={16} strokeWidth={2.5} aria-hidden="true" /> : null}
      </button>)}
    </div>
  );
  const menuContent = typeof document === "undefined" ? menu : createPortal(menu, document.body);

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
        <span className="app-select__label">{selected ? renderLabel?.(selected) ?? selected.label : placeholder ?? t("select.placeholder")}</span>
        <ChevronDown className="app-select__icon" size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {menuContent}
    </div>
  );
}
