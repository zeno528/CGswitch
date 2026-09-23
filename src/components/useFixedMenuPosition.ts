import { useLayoutEffect, useState, type RefObject } from "react";
import type { CSSProperties } from "react";

/** 菜单展示高度封顶（20rem），须与 style.css 里 .app-select-menu 的 max-height 保持一致。 */
export const MENU_MAX_HEIGHT = 320;

/// AppSelect 下拉与行内 ⋯ 菜单共用的 fixed 弹层定位：打开后按菜单真实展示高度
/// 判定下方空间，不够且上方更大时向上翻转，够则向下展开。
/// align "match" = 左缘对齐且同宽（下拉框）；"end" = 右缘对齐、宽度自适应（行菜单）。
export function useFixedMenuPosition(
  open: boolean,
  trigger: HTMLElement | null,
  menuRef: RefObject<HTMLDivElement | null>,
  align: "match" | "end",
): CSSProperties | undefined {
  const [style, setStyle] = useState<CSSProperties | undefined>(undefined);
  useLayoutEffect(() => {
    if (!open || !trigger) return;
    const updatePosition = () => {
      const menu = menuRef.current;
      if (!menu) return;
      const rect = trigger.getBoundingClientRect();
      const gap = 6;
      // 翻转判定用实际会展示的高度（CSS max-height 封顶后的值），而不是内容
      // 完整高度 scrollHeight：后者会高估需求，导致下方空间明明够却向上翻转
      const effectiveHeight = Math.min(menu.scrollHeight, MENU_MAX_HEIGHT);
      const below = window.innerHeight - rect.bottom - gap;
      const above = rect.top - gap;
      const openUp = below < effectiveHeight && above > below;
      setStyle({
        ...(align === "end"
          ? { left: "auto", right: `${window.innerWidth - rect.right}px` }
          : { left: `${rect.left}px`, width: `${rect.width}px` }),
        ...(openUp
          ? { top: "auto", bottom: `${window.innerHeight - rect.top + gap}px` }
          : { top: `${rect.bottom + gap}px`, bottom: "auto" }),
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [open, trigger, align]);
  return style;
}
