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
}
