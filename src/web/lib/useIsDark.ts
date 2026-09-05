// Tracks herdr-web's single global dark-mode signal: a `.dark` class on
// <html>. Extracted from DiffView.tsx (M3) so DiffView and the Files tab
// share one observer implementation instead of diverging copies.

import { useLayoutEffect, useState } from "react";

export function useIsDark(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark"),
  );
  useLayoutEffect(() => {
    if (typeof document === "undefined" || typeof MutationObserver === "undefined") return;
    const el = document.documentElement;
    const observer = new MutationObserver(() => setIsDark(el.classList.contains("dark")));
    observer.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}
