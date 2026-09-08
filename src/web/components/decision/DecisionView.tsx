import type {
  Decision,
  DecisionAnswer,
  DecisionDeliveryState,
  DecisionItem,
  DecisionItemAnswer,
} from "@contract/decision";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { PaneRow, Repo } from "@contract/events";
import { decisionApi } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useDecisionEvents, useHerdrState } from "@/lib/HerdrStoreContext";
import {
  clearDecisionDraft,
  type DecisionDraft,
  emptyDecisionDraft,
  getDecisionDraft,
  setDecisionDraft,
} from "@/lib/decisionDrafts";
import { Button } from "@/components/ui/button";
import { AgentStatusDot } from "@/components/ui/status/AgentStatusDot";
import { DeliveryChip } from "@/components/ui/status/DeliveryChip";
import { KindIcon } from "@/components/ui/status/KindIcon";
import { StatusChip } from "@/components/ui/status/StatusChip";
import { deliveryOf, turnOf } from "@/lib/statusVocab";
import { BlockView, type OpenLocation } from "./BlockView";
import { CompareOptions } from "./CompareOptions";
import { agentLabel, DECISION_STATUS_LABEL } from "./decisionLabels";

export type DecisionViewProps = {
  id: string;
  onClose?: () => void;
  /** F8-3 と同じ「pane を開く」。 */
  onFocusPane?: (paneId: string) => void;
  /** `location` Block クリック: ask の「対象ファイルを開く」と同じ経路
   * で Files タブを開く。決定ビュー自体は呼び出し元が閉じてよい。 */
  onOpenLocation?: OpenLocation;
};

function emptyAnswer(): DecisionItemAnswer {
  return { selected: [], other: null, note: null };
}

const DELIVERY_PROBLEM_HEADING: Record<DecisionDeliveryState, string> = {
  agent_blocked: "回答はエージェントに届いていません",
  gone: "回答の送り先が見つかりません",
  pending: "配達を再試行しています",
  sent: "回答は届いています",
  unknown: "配達状況を確認できません",
};

/** 未達アラート本文 (design.pen P13)。理由 + 試行回数 + 直近の試行からの経過分。 */
function deliveryProblemDescription(decision: Decision, elapsedMin: number): string {
  const attempts = decision.delivery?.attempts ?? 0;
  const suffix = `試行 ${attempts} 回・${elapsedMin} 分前`;
  switch (decision.delivery?.state) {
    case "agent_blocked":
      return `${decision.agent ?? "エージェント"} が入力待ち（blocked）のため agent.prompt を受け付けませんでした。ターミナルで入力待ちを解消してから再送してください。${suffix}`;
    case "gone":
      return `pane が見つかりませんでした。エージェントが終了したか pane が閉じられている可能性があります。${suffix}`;
    case "pending":
      return `herdr の再接続または再試行を待っています。${suffix}`;
    default:
      return `配達状況を確認できませんでした。${suffix}`;
  }
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

/** herdr は pane id を再利用しうるので、paneId が一致しても `agent` が
 * 一致しなければ別セッションの pane と判断し、見つからなかった扱いにする
 * （`agent` が null の依頼はレガシーデータなので id 一致だけで信頼する）。 */
export function findPane(
  repos: Repo[],
  paneId: string | null,
  agent: string | null,
): PaneRow | null {
  if (!paneId) return null;
  for (const repo of repos) {
    for (const worktree of repo.worktrees) {
      const pane = worktree.panes.find((p) => p.paneId === paneId);
      if (pane) return agent !== null && pane.agent !== agent ? null : pane;
    }
  }
  return null;
}

function worktreeBasename(root: string): string {
  const trimmed = root.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/** `session <先頭4>…<末尾4>` — 名前に Claude を出さない (docs/ui-redesign.md §5.4)。 */
function truncateSessionId(sessionId: string): string {
  if (sessionId.length <= 8) return sessionId;
  return `${sessionId.slice(0, 4)}…${sessionId.slice(-4)}`;
}

const ITEM_KIND_LABEL: Record<DecisionItem["kind"], string> = {
  single: "単一選択",
  multi: "複数選択",
  text: "自由記述",
  confirm: "確認",
};

/** 設問見出し用の番号バッジ。design.pen P3 の丸数字に合わせる。 */
function ItemNumberBadge({ index }: { index: number }) {
  return (
    <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
      {index + 1}
    </span>
  );
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
    <div className="flex flex-col gap-1" data-testid={`decision-answer-${item.id}`}>
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <ItemNumberBadge index={index} />
        {item.header}
      </div>
      <p className="text-sm text-muted-foreground">{item.question}</p>
      <p className="flex items-center gap-1 text-sm">
        {isAnswered(answer) && (
          <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
        )}
        {value}
      </p>
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
      className="flex flex-col gap-2 border-b border-border pb-4"
      data-testid={`decision-item-${item.id}`}
    >
      <legend className="flex items-center gap-1.5 text-sm font-medium">
        <ItemNumberBadge index={index} />
        {item.header}
        <span className="text-xs font-normal text-muted-foreground">
          {ITEM_KIND_LABEL[item.kind]}・{item.required === false ? "任意" : "必須"}
        </span>
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
        <div className="flex flex-col gap-1.5">
          {item.options.map((opt, optIndex) => {
            const checked = answer.selected.includes(opt.label);
            return (
              <div key={opt.label} className="flex flex-col gap-1">
                <label
                  className={cn(
                    "flex cursor-pointer items-start gap-2 rounded-md border p-3 text-sm",
                    checked ? "border-primary bg-accent ring-1 ring-primary" : "border-border",
                  )}
                >
                  <input
                    type={item.kind === "single" ? "radio" : "checkbox"}
                    name={`decision-item-${item.id}`}
                    checked={checked}
                    className="mt-0.5"
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
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{opt.label}</span>
                    {opt.recommended && (
                      <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] text-primary">
                        推奨
                      </span>
                    )}
                    {opt.description && (
                      <span className="block text-xs text-muted-foreground">{opt.description}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{optIndex + 1}</span>
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
          {(["yes", "no"] as const).map((value) => {
            const checked = answer.selected[0] === value;
            return (
              <label
                key={value}
                className={cn(
                  "cursor-pointer rounded-md border px-3 py-1.5 text-sm",
                  checked ? "border-primary bg-accent" : "border-border",
                )}
              >
                <input
                  type="radio"
                  name={`decision-item-${item.id}`}
                  checked={checked}
                  onChange={() => setSelected([value])}
                  className="sr-only"
                />
                {value === "yes" ? "はい" : "いいえ"}
              </label>
            );
          })}
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
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA";
}

/** 判断依頼ビュー (plan F13-8): context → 設問 → 回答フォーム → 送信 / 却下。 */
export function DecisionView({ id, onClose, onFocusPane, onOpenLocation }: DecisionViewProps) {
  const queryClient = useQueryClient();
  const state = useHerdrState();
  const query = useQuery({ queryKey: ["decision", id], queryFn: () => decisionApi.get(id) });
  const decision: Decision | undefined = query.data;

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 依頼ビューを離れても入力途中の回答を失わないよう、state は
  // localStorage 裏付けのストア (decisionDrafts.ts) に持つ — このコンポーネント
  // 自身は App.tsx のツール領域排他表示に伴って頻繁に unmount/remount される。
  const [prevId, setPrevId] = useState(id);
  const [draft, setDraft] = useState<DecisionDraft>(
    () => getDecisionDraft(id) ?? emptyDecisionDraft(),
  );
  if (id !== prevId) {
    setPrevId(id);
    setDraft(getDecisionDraft(id) ?? emptyDecisionDraft());
    setError(null);
  }
  const answers = draft.answers;

  const updateDraft = useCallback(
    (next: DecisionDraft) => {
      setDraft(next);
      setDecisionDraft(id, next);
    },
    [id],
  );

  // 新しい設問に既定の空回答を補う（既に入力済みの回答は上書きしない）。
  if (decision) {
    const missing = decision.spec.items.filter((item) => !(item.id in answers));
    if (missing.length > 0) {
      const nextAnswers = { ...answers };
      for (const item of missing) nextAnswers[item.id] = emptyAnswer();
      updateDraft({ ...draft, answers: nextAnswers });
    }
  }

  // 依頼が非 open になった（送信/却下/取り下げ）ら、もう使わない入力途中の
  // 下書きを localStorage から消す。dismiss/submit の成功パスに加え、他所
  // （別タブ、エージェントの `hw decision cancel`）で非 open になった場合も
  // イベント経由の再取得でここを通る。
  useEffect(() => {
    if (decision && decision.status !== "open") clearDecisionDraft(id);
  }, [decision, id]);

  useDecisionEvents(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: ["decision", id] });
    }, [queryClient, id]),
  );

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
      const current = draft.answers[item.id] ?? emptyAnswer();
      const nextAnswer = (() => {
        if (item.kind === "single") return { ...current, selected: [opt.label] };
        const already = current.selected.includes(opt.label);
        return {
          ...current,
          selected: already
            ? current.selected.filter((s) => s !== opt.label)
            : [...current.selected, opt.label],
        };
      })();
      updateDraft({ ...draft, answers: { ...draft.answers, [item.id]: nextAnswer } });
    }
    window.addEventListener("keydown", handleDigit);
    return () => window.removeEventListener("keydown", handleDigit);
  }, [decision, draft, updateDraft]);

  // フックはここまでで全て呼び終える（早期 return の後には置けない）。
  const elapsedMin = useElapsedMinutes(decision?.createdAt ?? null);
  const answeredElapsedMin = useElapsedMinutes(decision?.answeredAt ?? null);
  const deliveryElapsedMin = useElapsedMinutes(decision?.delivery?.at ?? null);

  if (query.isLoading) return <div className="p-4 text-sm text-muted-foreground">読み込み中…</div>;
  if (!decision) return <div className="p-4 text-sm text-destructive">依頼が見つかりません</div>;

  function updateItem(itemId: string, next: DecisionItemAnswer) {
    updateDraft({ ...draft, answers: { ...answers, [itemId]: next } });
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
      const body: DecisionAnswer = { answers };
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
  const delivery = deliveryOf("decision", decision.delivery);
  // §6.3 の canResend は状態だけを見る。cancelled（取り下げ）はエージェント側の
  // 操作で終わっているので、配達が滞っていても再送の宛先が無い。
  const canResend = delivery.canResend && decision.status !== "cancelled";
  const hasDeliveryProblem = decision.delivery !== null && delivery.state !== "sent";
  // レビュー指摘: 起動直後（WS 未接続 / tree 未着）に「見つからない」＝
  // 「pane 消失」と決めつけると、実際には生きているエージェントを死んだと
  // 誤表示する。tree がまだ 1 件も届いていない、または接続が確立していない
  // 間は「不明」として扱う。
  const settling = state.connection !== "open" || state.repos.length === 0;
  const pane = settling ? null : findPane(state.repos, decision.paneId, decision.agent);

  return (
    <div
      className="flex h-full w-full flex-col overflow-auto"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && isOpen && !busy) void submit();
      }}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1 text-xs text-muted-foreground">
        <nav className="flex items-center gap-1">
          <button type="button" onClick={onClose} className="hover:text-foreground hover:underline">
            Decisions
          </button>
          <span>/</span>
          <span>判断依頼 …{id.slice(-4)}</span>
        </nav>
        <kbd className="rounded border border-border px-1 py-0.5">Esc で閉じる</kbd>
      </div>

      <header className="flex shrink-0 flex-col gap-1 border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <KindIcon kind="decision" />
          <h2 className="min-w-0 flex-1 truncate text-sm font-semibold">
            {decision.spec.title ?? decision.spec.items[0]?.header ?? "判断依頼"}
          </h2>
          <StatusChip
            turn={turnOf("decision", decision.status)}
            label={DECISION_STATUS_LABEL[decision.status]}
          />
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {settling ? (
            <AgentStatusDot status="unknown" label="状態を取得中" className="shrink-0" />
          ) : pane ? (
            <AgentStatusDot
              status={pane.agentStatus}
              label={agentLabel(decision.agent, pane)}
              className="shrink-0"
            />
          ) : (
            <span className="shrink-0">{decision.agent ?? "?"} · pane 消失</span>
          )}
          {decision.worktreeRoot && (
            <span className="min-w-0 shrink truncate" title={decision.worktreeRoot}>
              {worktreeBasename(decision.worktreeRoot)}
            </span>
          )}
          {decision.claudeSessionId && (
            <span className="shrink-0">session {truncateSessionId(decision.claudeSessionId)}</span>
          )}
          <span className="shrink-0">
            {decision.answeredAt
              ? `${elapsedMin} 分前に依頼・${answeredElapsedMin} 分前に回答`
              : `${elapsedMin} 分前に依頼`}
          </span>
          <span className="flex-1" />
          {decision.paneId && onFocusPane && (
            <Button
              type="button"
              size="xs"
              variant="outline"
              className="shrink-0"
              onClick={() => onFocusPane(decision.paneId!)}
            >
              pane を開く
            </Button>
          )}
        </div>
      </header>

      {hasDeliveryProblem && decision.delivery && (
        <div
          data-testid="decision-delivery-warning"
          className="flex shrink-0 flex-col gap-1 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium text-amber-700 dark:text-amber-400">
              {DELIVERY_PROBLEM_HEADING[decision.delivery.state]}
            </span>
            <DeliveryChip
              delivery={{ ...delivery, canResend }}
              onResend={() => void resend()}
              busy={busy}
            />
          </div>
          <p className="text-muted-foreground">
            {deliveryProblemDescription(decision, deliveryElapsedMin)}
          </p>
        </div>
      )}

      {decision.spec.context.length > 0 &&
        (isOpen ? (
          <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">コンテキスト</p>
            {decision.spec.context.map((block, i) => (
              <BlockView
                key={i}
                block={block}
                worktreeRoot={decision.worktreeRoot}
                onOpenLocation={onOpenLocation}
              />
            ))}
          </div>
        ) : (
          <details
            data-testid="decision-context"
            className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2"
          >
            <summary className="cursor-pointer text-xs text-muted-foreground">context</summary>
            <div className="flex flex-col gap-2 pt-1">
              {decision.spec.context.map((block, i) => (
                <BlockView
                  key={i}
                  block={block}
                  worktreeRoot={decision.worktreeRoot}
                  onOpenLocation={onOpenLocation}
                />
              ))}
            </div>
          </details>
        ))}

      <div className="flex flex-1 flex-col gap-[18px] px-3 py-2">
        {isOpen ? (
          decision.spec.items.map((item, index) => (
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
          ))
        ) : (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <p className="text-xs font-medium text-muted-foreground">
              確定した回答（読み取り専用）
            </p>
            {decision.spec.items.map((item, index) => (
              <DecisionAnswerView
                key={item.id}
                item={item}
                index={index}
                answer={decision.answer?.answers[item.id]}
              />
            ))}
          </div>
        )}
      </div>

      {error && <p className="shrink-0 px-3 py-1 text-xs text-destructive">{error}</p>}

      {isOpen && (
        <footer className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2">
          <Button type="button" onClick={() => void submit()} disabled={busy}>
            送信
          </Button>
          <Button type="button" variant="ghost" onClick={() => void dismiss()} disabled={busy}>
            却下
          </Button>
          <span className="text-xs text-muted-foreground">1–9 で選択 · ⌘Enter で送信</span>
        </footer>
      )}
    </div>
  );
}
