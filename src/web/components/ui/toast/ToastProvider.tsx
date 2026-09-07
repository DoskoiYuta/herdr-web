// アプリ全体で 1 系統の toast（docs/ui-redesign.md §5.6/D6）。右下スタック、
// 既定 4 秒（action 付きは 8 秒）で自動的に消える。`sticky: true` は自動で
// 消えない（進捗表示など、完了/失敗を明示的に置き換えるまで残す）。`id` を
// 指定すると同じ id の既存 toast を積まずに置き換える。DiffPanel の
// #toast、FilesPanel の useTransientMessage、GraphPanel の fetch 結果表示、
// router の openLocationMessage、SendDraftsButton の sendError はこれに統一する。
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ToastKind = "info" | "success" | "warning" | "error";

export type ToastInput = {
  kind: ToastKind;
  message: string;
  action?: { label: string; onClick: () => void };
  /** 自動で消えない。`id` を指定して次の呼び出しで置き換えるか、
   * `toast.dismiss(id)` で明示的に消す（進捗表示用）。 */
  sticky?: boolean;
  /** 指定すると、同じ id の既存 toast をスタックに積まず置き換える。 */
  id?: string;
};

type ToastItem = ToastInput & { key: string | number };

const DEFAULT_DURATION_MS = 4000;
const ACTION_DURATION_MS = 8000;

export type ToastFn = ((toast: ToastInput) => void) & { dismiss: (id: string) => void };

const ToastContext = createContext<ToastFn | null>(null);

const KIND_CLASS: Record<ToastKind, string> = {
  info: "border-border bg-popover text-popover-foreground",
  success: "border-emerald-500/30 bg-popover text-popover-foreground",
  warning: "border-amber-500/30 bg-popover text-popover-foreground",
  error: "border-destructive/40 bg-popover text-popover-foreground",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<string | number, ReturnType<typeof setTimeout>>());

  const clearTimer = useCallback((key: string | number) => {
    const t = timers.current.get(key);
    if (t !== undefined) {
      clearTimeout(t);
      timers.current.delete(key);
    }
  }, []);

  const remove = useCallback(
    (key: string | number) => {
      clearTimer(key);
      setToasts((cur) => cur.filter((t) => t.key !== key));
    },
    [clearTimer],
  );

  const dismiss = useCallback((id: string) => remove(id), [remove]);

  const toast = useCallback(
    (input: ToastInput) => {
      const key = input.id ?? nextId.current++;
      clearTimer(key);
      setToasts((cur) => [...cur.filter((t) => t.key !== key), { ...input, key }]);
      if (!input.sticky) {
        const duration = input.action ? ACTION_DURATION_MS : DEFAULT_DURATION_MS;
        timers.current.set(
          key,
          setTimeout(() => remove(key), duration),
        );
      }
    },
    [clearTimer, remove],
  ) as ToastFn;
  toast.dismiss = dismiss;

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-end gap-2 px-4">
        {toasts.map((t) => (
          <div
            key={t.key}
            data-testid="toast"
            data-toast-kind={t.kind}
            className={cn(
              "pointer-events-auto flex max-w-sm items-center gap-3 rounded-md border px-3 py-2 text-sm shadow-md",
              KIND_CLASS[t.kind],
            )}
          >
            <span className="min-w-0 flex-1">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="shrink-0 font-medium underline underline-offset-2 hover:opacity-80"
                onClick={() => {
                  t.action?.onClick();
                  remove(t.key);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Toast を出す。`ToastProvider` の外で呼ぶと例外を投げる（配線漏れを早期に気づけるように）。 */
export function useToast(): ToastFn {
  const toast = useContext(ToastContext);
  if (!toast) throw new Error("useToast must be used within a ToastProvider");
  return toast;
}
