import { useEffect, useRef, useState } from "react";
import { KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from "@dnd-kit/core";
import { arrayMove } from "@dnd-kit/sortable";

interface CardDragReorder {
  sensors: ReturnType<typeof useSensors>;
  draggedId: string | null;
  dragHoverId: string | null;
  dragWidth: number | null;
  dragHeight: number | null;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  onDragCancel: () => void;
}

/** 供应商卡片拖拽重排的公共编排：传感器、拖拽态、卡片悬浮抑制、arrayMove + 持久化。
 *  Codex / Claude Code 供应商列表共用；持久化由调用方注入（失败回滚 items 由本钩子负责，
 *  刷新等善后由调用方的 persist 闭包自理）。 */
export function useCardDragReorder<T extends { id: string }>(
  items: T[],
  setItems: (items: T[]) => void,
  persist: (previous: T[], next: T[]) => Promise<void>,
): CardDragReorder {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragHoverId, setDragHoverId] = useState<string | null>(null);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const dragHoverReleaseRef = useRef<(() => void) | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  useEffect(() => () => {
    document.body.classList.remove("drag-active");
    dragHoverReleaseRef.current?.();
  }, []);

  const releaseCardHoverSuppression = () => {
    const release = dragHoverReleaseRef.current;
    if (release) release();
  };

  // 拖拽期间卡片 hover 态会穿透 DragOverlay 造成闪烁：进拖拽先压掉，首个 pointermove 恢复
  const suppressCardHover = () => {
    releaseCardHoverSuppression();
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement.classList.contains("drag-handle")) activeElement.blur();
    const release = () => {
      setDragHoverId(null);
      window.removeEventListener("pointermove", release);
      if (dragHoverReleaseRef.current === release) dragHoverReleaseRef.current = null;
    };
    dragHoverReleaseRef.current = release;
    window.addEventListener("pointermove", release, { once: true });
  };

  const onDragEnd = (event: DragEndEvent) => {
    document.body.classList.remove("drag-active");
    suppressCardHover();
    setDraggedId(null);
    setDragWidth(null);
    setDragHeight(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = items.findIndex((item) => item.id === String(active.id));
    const newIndex = items.findIndex((item) => item.id === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const previous = items;
    const next = arrayMove(items, oldIndex, newIndex);
    setItems(next);
    void persist(previous, next);
  };

  const onDragStart = ({ active }: DragStartEvent) => {
    releaseCardHoverSuppression();
    document.body.classList.add("drag-active");
    const source = [...document.querySelectorAll<HTMLElement>("[data-profile-id]")]
      .find((node) => node.dataset.profileId === String(active.id));
    const sourceRect = source?.getBoundingClientRect();
    setDraggedId(String(active.id));
    setDragHoverId(String(active.id));
    setDragWidth(active.rect.current.initial?.width ?? sourceRect?.width ?? null);
    setDragHeight(active.rect.current.initial?.height ?? sourceRect?.height ?? null);
  };

  const onDragCancel = () => {
    document.body.classList.remove("drag-active");
    suppressCardHover();
    setDraggedId(null);
    setDragWidth(null);
    setDragHeight(null);
  };

  return { sensors, draggedId, dragHoverId, dragWidth, dragHeight, onDragStart, onDragEnd, onDragCancel };
}
