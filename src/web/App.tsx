import { useState } from "react";
import { RouterProvider } from "@tanstack/react-router";
import { ToastProvider } from "@/components/ui/toast/ToastProvider";
import { HerdrStoreProvider } from "@/lib/HerdrStoreContext";
import { createAppRouter } from "./router";

export type AppProps = {
  /** テスト用にルーターを差し替える（メモリ履歴で戻る/進む/リロード相当を検証する）。
   * 省略時はブラウザ履歴のルーターを 1 つだけ作る。 */
  router?: ReturnType<typeof createAppRouter>;
};

export function App({ router }: AppProps = {}) {
  const [ownRouter] = useState(() => router ?? createAppRouter());
  return (
    <ToastProvider>
      <HerdrStoreProvider>
        <RouterProvider router={ownRouter} />
      </HerdrStoreProvider>
    </ToastProvider>
  );
}
