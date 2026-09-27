import { useEffect, type RefObject } from "react";

/**
 * 弹层打开期间的统一收起逻辑，AppSelect 下拉与端点输入框下拉共用：
 * - 触发器/菜单以外 pointerdown → 收起
 * - 菜单以外滚动 → 收起（fixed 弹层不跟随触发器，留着会脱锚跳跑）
 * - Escape → 收起
 * close 传稳定的 boolean setState（如 setOpen），内部固定回 false；ref 引用稳定，监听器只在 open 变化时挂卸。
 */
export function useMenuDismiss(
  open: boolean,
  rootRef: RefObject<HTMLElement | null>,
  menuRef: RefObject<HTMLElement | null>,
  close: (next: boolean) => void,
) {
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) close(false);
    };
    const onBackgroundScroll = (event: Event) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onBackgroundScroll, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onBackgroundScroll, true);
    };
  }, [open, close]);
}
