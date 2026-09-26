import { useEffect, useRef, type RefObject } from "react";

/**
 * 弹层打开期间的统一收起逻辑，AppSelect 下拉与端点输入框下拉共用：
 * - 触发器/菜单以外 pointerdown → 收起
 * - 菜单以外滚动 → 收起（fixed 弹层不跟随触发器，留着会脱锚跳跑）
 * - Escape → 收起
 * close 走 latest-ref，监听器只在 open 变化时挂卸。
 */
export function useMenuDismiss(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  close: () => void,
) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) closeRef.current();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open, rootRef, menuRef]);

  useEffect(() => {
    if (!open) return;
    const onBackgroundScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      closeRef.current();
    };
    window.addEventListener("scroll", onBackgroundScroll, true);
    return () => window.removeEventListener("scroll", onBackgroundScroll, true);
  }, [open, menuRef]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);
}
