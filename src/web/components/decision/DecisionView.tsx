import type {
  Decision,
  DecisionAnswer,
  DecisionEvent,
  DecisionItem,
  DecisionItemAnswer,
} from "@contract/decision";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { decisionApi } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { BlockView, type OpenLocation } from "./BlockView";
import { CompareOptions } from "./CompareOptions";

export type DecisionViewProps = {
  id: string;
  onClose?: () => void;
  /** F8-3 と同じ「pane を開く」。 */
  onFocusPane?: (paneId: string) => void;
  subscribeDecisionEvents?: (cb: (event: DecisionEvent) => void) => () => void;
  /** `location` Block クリック: ask の「対象ファイルを開く」と同じ経路
   * で Files タブを開く。決定ビュー自体は呼び出し元 (App.tsx) が閉じてよい。 */
  onOpenLocation?: OpenLocation;
};

type AnswerState = Record<string, DecisionItemAnswer>;

function emptyAnswer(): DecisionItemAnswer {
  return { selected: [], other: null, note: null };
}

/** `Date.now()` はレンダー本体で直接呼べない (impure) ので、初期値は lazy
 * initializer で 1 度だけ読み、以後は 1 分ごとのタイマーで更新する。 */
function useElapsedMinutes(createdAt: string | null): number {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);
  if (createdAt === null) return 0;
  return Math.max(0, Math.round((nowMs - new Date(createdAt).getTime()) / 60_000));
}

function isAnswered(answer: DecisionItemAnswer | undefined): boolean {
  if (!answer) return false;
  if (answer.selected.length > 0) return true;
  return (answer.other ?? "").trim().length > 0;
}

/** 確定した依頼を開いたときの読み取り専用表示 (plan F13-8)。 */
function DecisionAnswerView({
  item,
  index,
  answer,
}: {
  item: DecisionItem;
  index: number;
  answer: DecisionItemAnswer | undefined;
}) {
  const selected = answer?.selected ?? [];
  const other = answer?.other ?? null;
  const note = answer?.note ?? null;

  const value =
    item.kind === "confirm"
      ? selected[0] === "yes"
        ? "はい"
        : selected[0] === "no"
          ? "いいえ"
          : "(未回答)"
      : [selected.join(", ") || null, other ? `その他: ${other}` : null]
          .filter(Boolean)
          .join(" / ") || "(未回答)";

  return (
    <div
      className="flex flex-col gap-1 border-b border-border pb-3"
      data-testid={`decision-answer-${item.id}`}
    >
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <span className="text-xs text-muted-foreground">{index + 1}.</span>
        {item.header}
      </div>
      <p className="text-sm text-muted-foreground">{item.question}</p>
      <p className="text-sm">{value}</p>
      {note && <p className="text-xs text-muted-foreground">メモ: {note}</p>}
    </div>
  );
}

function DecisionItemForm({
  item,
  index,
  answer,
  onChange,
  compare,
  worktreeRoot,
  onOpenLocation,
}: {
  item: DecisionItem;
  index: number;
  answer: DecisionItemAnswer;
  onChange: (next: DecisionItemAnswer) => void;
  /** `layout: "compare"` applies only when some option actually has a
   * preview — otherwise the compare grid would show empty cards. */
  compare: boolean;
  worktreeRoot: string | null;
  onOpenLocation?: OpenLocation;
}) {
  const setSelected = (selected: string[]) => onChange({ ...answer, selected });
  const setOther = (other: string) =>
    onChange({ ...answer, other: other.length > 0 ? other : null });
  const setNote = (note: string) => onChange({ ...answer, note: note.length > 0 ? note : null });

  return (
    <fieldset
      className="flex flex-col gap-1.5 border-b border-border pb-3"
      data-testid={`decision-item-${item.id}`}
    >
      <legend className="flex items-center gap-1.5 text-sm font-medium">
        <span className="text-xs text-muted-foreground">{index + 1}.</span>
        {item.header}
        {item.required === false && (
          <span className="text-xs font-normal text-muted-foreground">(任意)</span>
        )}
      </legend>
      <p className="text-sm">{item.question}</p>

      {(item.kind === "single" || item.kind === "multi") && compare && (
        <>
          <CompareOptions
            item={item}
            answer={answer}
            onChange={onChange}
            worktreeRoot={worktreeRoot}
            onOpenLocation={onOpenLocation}
          />
          {(item.allowOther ?? true) && (
            <label className="flex items-center gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">その他:</span>
              <input
                type="text"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-sm"
                value={answer.other ?? ""}
                onChange={(e) => setOther(e.target.value)}
                aria-label={`${item.header} その他`}
              />
            </label>
          )}
        </>
      )}

      {(item.kind === "single" || item.kind === "multi") && !compare && (
        <div className="flex flex-col gap-1">
          {item.options.map((opt) => {
            const checked = answer.selected.includes(opt.label);
            return (
              <div key={opt.label} className="flex flex-col gap-1">
                <label className="flex items-start gap-1.5 text-sm">
                  <input
                    type={item.kind === "single" ? "radio" : "checkbox"}
                    name={`decision-item-${item.id}`}
                    checked={checked}
                    onChange={(e) => {
                      if (item.kind === "single") {
                        setSelected(e.target.checked ? [opt.label] : []);
                      } else {
                        setSelected(
                          e.target.checked
                            ? [...answer.selected, opt.label]
                            : answer.selected.filter((s) => s !== opt.label),
                        );
                      }
                    }}
                  />
                  <span>
                    {opt.label}
                    {opt.recommended && (
                      <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] text-primary">
                        推奨
                      </span>
                    )}
                    {opt.description && (
                      <span className="ml-1 text-xs text-muted-foreground">{opt.description}</span>
                    )}
                  </span>
                </label>
                {opt.preview.length > 0 && (
                  <details className="ml-5">
                    <summary className="cursor-pointer text-xs text-muted-foreground">
                      プレビュー
                    </summary>
                    <div className="flex flex-col gap-1.5 pt-1">
                      {opt.preview.map((block, i) => (
                        <BlockView
                          key={i}
                          block={block}
                          worktreeRoot={worktreeRoot}
                          onOpenLocation={onOpenLocation}
                        />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            );
          })}
          {(item.allowOther ?? true) && (
            <label className="flex items-center gap-1.5 text-sm">
              <span className="text-xs text-muted-foreground">その他:</span>
              <input
                type="text"
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-1.5 py-0.5 text-sm"
                value={answer.other ?? ""}
                onChange={(e) => setOther(e.target.value)}
                aria-label={`${item.header} その他`}
              />
            </label>
          )}
        </div>
      )}

      {item.kind === "text" && (
        <textarea
          className="min-h-16 rounded-md border border-border bg-background px-1.5 py-1 text-sm"
          value={answer.other ?? ""}
          onChange={(e) => setOther(e.target.value)}
          aria-label={item.header}
        />
      )}

      {item.kind === "confirm" && (
        <div className="flex gap-2">
          {(["yes", "no"] as const).map((value) => (
            <label key={value} className="flex items-center gap-1 text-sm">
              <input
                type="radio"
                name={`decision-item-${item.id}`}
                checked={answer.selected[0] === value}
                onChange={() => setSelected([value])}
              />
              {value === "yes" ? "はい" : "いいえ"}
            </label>
          ))}
        </div>
      )}

      <input
        type="text"
        placeholder="メモ (任意)"
        className="rounded-md border border-border bg-background px-1.5 py-0.5 text-xs"
        value={answer.note ?? ""}
        onChange={(e) => setNote(e.target.value)}
        aria-label={`${item.header} メモ`}
      />
    </fieldset>
  );
}

/** フォーカスが入力欄にあるとき、1〜9 のショートカットは通常の文字入力として扱う。 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

/** 判断依頼ビュー (plan F13-8): context → 設問 → 回答フォーム → 送信 / 却下。 */
export function DecisionView({
  id,
  onClose,
  onFocusPane,
  subscribeDecisionEvents,
  onOpenLocation,
}: DecisionViewProps) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ["decision", id], queryFn: () => decisionApi.get(id) });
  const decision: Decision | undefined = query.data;

  const [answers, setAnswers] = useState<AnswerState>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 依頼が切り替わったら回答フォームをリセットする。
  const [loadedId, setLoadedId] = useState<string | null>(null);
  if (decision && loadedId !== decision.id) {
    setLoadedId(decision.id);
    setAnswers(Object.fromEntries(decision.spec.items.map((item) => [item.id, emptyAnswer()])));
    setError(null);
  }

  useEffect(() => {
    if (!subscribeDecisionEvents) return;
    return subscribeDecisionEvents(() => {
      void queryClient.invalidateQueries({ queryKey: ["decision", id] });
    });
  }, [subscribeDecisionEvents, queryClient, id]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  // 1〜9 で選択肢を選ぶ (plan F13-8)。単一設問 (最初の single/multi item) を対象にする。
  useEffect(() => {
    function handleDigit(e: KeyboardEvent) {
      if (!decision || decision.status !== "open") return;
      if (isTypingTarget(e.target)) return;
      const digit = Number(e.key);
      if (!Number.isInteger(digit) || digit < 1 || digit > 9) return;
      const item = decision.spec.items.find((it) => it.kind === "single" || it.kind === "multi");
      if (!item) return;
      const opt = item.options[digit - 1];
      if (!opt) return;
      setAnswers((prev) => {
        const current = prev[item.id] ?? emptyAnswer();
        if (item.kind === "single") {
          return { ...prev, [item.id]: { ...current, selected: [opt.label] } };
        }
        const already = current.selected.includes(opt.label);
        return {
          ...prev,
          [item.id]: {
            ...current,
            selected: already
              ? current.selected.filter((s) => s !== opt.label)
              : [...current.selected, opt.label],
          },
        };
      });
    }
    window.addEventListener("keydown", handleDigit);
    return () => window.removeEventListener("keydown", handleDigit);
  }, [decision]);

  // フックはここまでで全て呼び終える（早期 return の後には置けない）。
  const elapsedMin = useElapsedMinutes(decision?.createdAt ?? null);

  if (query.isLoading) return <div className="p-4 text-sm text-muted-foreground">読み込み中…</div>;
  if (!decision) return <div className="p-4 text-sm text-destructive">依頼が見つかりません</div>;

  function updateItem(itemId: string, next: DecisionItemAnswer) {
    setAnswers((prev) => ({ ...prev, [itemId]: next }));
  }

  function validate(): string | null {
    for (const item of decision!.spec.items) {
      if (item.required === false) continue;
      if (!isAnswered(answers[item.id])) return `「${item.header}」に回答してください`;
    }
    return null;
  }

  async function submit() {
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: DecisionAnswer = { answers, attachments: [] };
      await decisionApi.answer(id, body);
      await queryClient.invalidateQueries({ queryKey: ["decision", id] });
      await queryClient.invalidateQueries({ queryKey: ["decision-counts"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "送信に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function dismiss() {
    setBusy(true);
    setError(null);
    try {
      await decisionApi.dismiss(id);
      await queryClient.invalidateQueries({ queryKey: ["decision", id] });
      await queryClient.invalidateQueries({ queryKey: ["decision-counts"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "却下に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await decisionApi.resend(id);
      await queryClient.invalidateQueries({ queryKey: ["decision", id] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "再送に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  const isOpen = decision.status === "open";
  const canResend =
    (decision.status === "answered" || decision.status === "dismissed") &&
    decision.delivery?.state !== "sent";

  return (
    <div
      className="flex h-full w-full flex-col overflow-auto"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && isOpen && !busy) void submit();
      }}
    >
      <header className="flex shrink-0 flex-col gap-1 border-b border-border px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="truncate text-sm font-semibold">{decision.spec.title ?? "判断依頼"}</h2>
          {onClose && (
            <Button type="button" size="sm" variant="ghost" onClick={onClose}>
              閉じる
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>{decision.agent ?? "?"}</span>
          {decision.worktreeRoot && <span>{decision.worktreeRoot}</span>}
          {decision.claudeSessionId && <span>session: {decision.claudeSessionId.slice(0, 8)}</span>}
          <span>{elapsedMin} 分前</span>
          <span>状態: {decision.status}</span>
          {decision.paneId && onFocusPane && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => onFocusPane(decision.paneId!)}
            >
              pane を開く
            </Button>
          )}
        </div>
      </header>

      {decision.spec.context.length > 0 && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
          {decision.spec.context.map((block, i) => (
            <BlockView
              key={i}
              block={block}
              worktreeRoot={decision.worktreeRoot}
              onOpenLocation={onOpenLocation}
            />
          ))}
        </div>
      )}

      <div className="flex flex-1 flex-col gap-3 px-3 py-2">
        {decision.spec.items.map((item, index) =>
          isOpen ? (
            <DecisionItemForm
              key={item.id}
              item={item}
              index={index}
              answer={answers[item.id] ?? emptyAnswer()}
              onChange={(next) => updateItem(item.id, next)}
              compare={
                decision.spec.layout === "compare" &&
                (item.kind === "single" || item.kind === "multi") &&
                item.options.some((o) => o.preview.length > 0)
              }
              worktreeRoot={decision.worktreeRoot}
              onOpenLocation={onOpenLocation}
            />
          ) : (
            <DecisionAnswerView
              key={item.id}
              item={item}
              index={index}
              answer={decision.answer?.answers[item.id]}
            />
          ),
        )}
      </div>

      {error && <p className="shrink-0 px-3 py-1 text-xs text-destructive">{error}</p>}

      {isOpen ? (
        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            送信
          </Button>
          <Button type="button" variant="ghost" onClick={() => void dismiss()} disabled={busy}>
            却下
          </Button>
        </footer>
      ) : (
        <footer className="flex shrink-0 flex-col gap-1 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span>
            配達:{" "}
            {decision.delivery
              ? `${decision.delivery.state} (試行 ${decision.delivery.attempts} 回)`
              : "-"}
          </span>
          {canResend && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => void resend()}
              disabled={busy}
            >
              再送
            </Button>
          )}
        </footer>
      )}
    </div>
  );
}
