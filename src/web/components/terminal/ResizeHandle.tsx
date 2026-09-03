// ターミナル領域とツール領域の境界にあるドラッグ可能なディバイダー。
// terminal-diff の src/client/components/ResizeHandle.tsx を移植し、
// 外部 CSS クラスの代わりに Tailwind クラスを使うよう調整している。
// ポインタ駆動のリサイズとキーボードフォールバック（ArrowLeft/ArrowRight）、
// ダブルクリックでの既定値リセットを持つ。幅の永続化は呼び出し側の責務で、
// このコンポーネントはドラッグ中の値（onResize）と確定値（onResizeEnd）を
// 報告するだけの純粋な見た目のコンポーネント。

import { useCallback, useRef } from "react";
import { cn } from "@/lib/utils";

const KEYBOARD_STEP = 16;

export type ResizeHandleProps = {
  width: number;
  min: number;
  max: number;
  defaultWidth: number;
  onResize(width: number): void;
  onResizeEnd(width: number): void;
  /**
   * ポインタを右へドラッグしたときに width を増やすか減らすか。
   * ツール領域のようにハンドルの右側が本体で、左へドラッグするほど
   * 広がってほしい場合は "left" を指定する。
   */
  direction?: "right" | "left";
  className?: string;
};

export function ResizeHandle({
  width,
  min,
  max,
  defaultWidth,
  onResize,
  onResizeEnd,
  direction = "right",
  className,
}: ResizeHandleProps) {
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const prevUserSelectRef = useRef<string | null>(null);
  const sign = direction === "right" ? 1 : -1;

  const clamp = useCallback((n: number) => Math.round(Math.min(max, Math.max(min, n))), [min, max]);

  const beginDrag = useCallback(
    (pointerId: number, startX: number, target: Element) => {
      dragRef.current = { pointerId, startX, startWidth: width };
      prevUserSelectRef.current = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      (target as Element & { setPointerCapture?(id: number): void }).setPointerCapture?.(pointerId);
    },
    [width],
  );

  const endDrag = useCallback(
    (finalWidth: number, target: Element, pointerId: number) => {
      dragRef.current = null;
      document.body.style.userSelect = prevUserSelectRef.current ?? "";
      prevUserSelectRef.current = null;
      (target as Element & { releasePointerCapture?(id: number): void }).releasePointerCapture?.(
        pointerId,
      );
      onResizeEnd(finalWidth);
    },
    [onResizeEnd],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      beginDrag(event.pointerId, event.clientX, event.currentTarget);
    },
    [beginDrag],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const next = clamp(drag.startWidth + sign * (event.clientX - drag.startX));
      onResize(next);
    },
    [clamp, onResize, sign],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const next = clamp(drag.startWidth + sign * (event.clientX - drag.startX));
      endDrag(next, event.currentTarget, event.pointerId);
    },
    [clamp, endDrag, sign],
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      endDrag(clamp(width), event.currentTarget, event.pointerId);
    },
    [clamp, endDrag, width],
  );

  const handleDoubleClick = useCallback(() => {
    onResize(defaultWidth);
    onResizeEnd(defaultWidth);
  }, [defaultWidth, onResize, onResizeEnd]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        const next = clamp(width - KEYBOARD_STEP);
        onResize(next);
        onResizeEnd(next);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        const next = clamp(width + KEYBOARD_STEP);
        onResize(next);
        onResizeEnd(next);
      }
    },
    [clamp, onResize, onResizeEnd, width],
  );

  return (
    <div
      className={cn(
        "w-1 shrink-0 cursor-col-resize touch-none bg-border hover:bg-ring focus-visible:bg-ring focus-visible:outline-none",
        className,
      )}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
    />
  );
}
