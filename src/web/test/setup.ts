import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});

// jsdom には Radix UI（context-menu/dialog 等）が使う PointerEvent 系 API や
// scrollIntoView が実装されていない。未実装のまま呼ぶと内部でエラーが投げられ、
// テストからは「メニュー/ダイアログが一向に開かない」ようにしか見えず原因が分か
// りにくい（fireEvent 自体は成功したように見えて `findBy*` が延々タイムアウトする）
// ので、no-op のポリフィルをここで用意しておく。
if (typeof window !== "undefined") {
  // React DOM only attaches native `pointerdown`/`pointerup` listeners when
  // `window.PointerEvent` exists (feature-detected once at module load) —
  // jsdom has no PointerEvent constructor at all, so without this, Radix
  // components whose trigger opens on pointerdown (DropdownMenu; Select/
  // Popover's trigger does too) never see the event and silently never open
  // in tests, indistinguishable from a real bug in the component under test.
  if (!window.PointerEvent) {
    class PointerEventPolyfill extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 1;
        this.pointerType = params.pointerType ?? "mouse";
      }
    }
    // @ts-expect-error jsdom has no native PointerEvent to satisfy the lib.dom type exactly
    window.PointerEvent = PointerEventPolyfill;
  }
  // Radix's Popper (Select/DropdownMenu/Popover positioning) uses floating-ui,
  // which falls back to a tight recursive `requestAnimationFrame` re-measure
  // loop when `ResizeObserver` is unavailable — jsdom has none. That loop
  // doesn't error, so a test opening one of these menus doesn't fail; it just
  // burns CPU for seconds until something else (GC pressure, a timer) breaks
  // it up, which reads as a mysteriously slow/flaky `findBy*` rather than a
  // missing API.
  if (!window.ResizeObserver) {
    class ResizeObserverPolyfill {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    window.ResizeObserver = ResizeObserverPolyfill;
  }
  if (!window.HTMLElement.prototype.hasPointerCapture) {
    window.HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!window.HTMLElement.prototype.setPointerCapture) {
    window.HTMLElement.prototype.setPointerCapture = () => {};
  }
  if (!window.HTMLElement.prototype.releasePointerCapture) {
    window.HTMLElement.prototype.releasePointerCapture = () => {};
  }
  if (!window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
  // TanStack Router's scroll restoration calls window.scrollTo on every
  // navigation; jsdom's own scrollTo is a stub that logs "not implemented"
  // instead of a no-op.
  window.scrollTo = () => {};
}
