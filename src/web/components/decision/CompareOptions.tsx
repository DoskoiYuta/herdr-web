import type { DecisionItem, DecisionItemAnswer } from "@contract/decision";
import { BlockView, type OpenLocation } from "./BlockView";

const INTERACTIVE_SELECTOR = "button, a, input, textarea, select, summary, iframe";

/** options with a `preview` are laid out as cards instead of a radio/checkbox
 * list, so the previews can be compared side by side. A `div[role=button]`
 * rather than `<button>` — cards can contain their own interactive Blocks (a
 * `location` link, an `html` iframe), which `<button>` can't nest without
 * breaking HTML validity. Selecting the card must not fire when the click
 * actually landed on one of those nested interactive elements. */
export function CompareOptions({
  item,
  answer,
  onChange,
  worktreeRoot,
  onOpenLocation,
  readOnly = false,
}: {
  item: DecisionItem;
  answer: DecisionItemAnswer;
  onChange: (next: DecisionItemAnswer) => void;
  worktreeRoot: string | null;
  onOpenLocation?: OpenLocation;
  /** 確定済みの依頼を開いたときの表示 (spec-F): 選ばれたカードだけ
   * `bg-accent`、他は薄く表示しクリックできない。 */
  readOnly?: boolean;
}) {
  function toggle(label: string) {
    if (item.kind === "single") {
      // single では「その他」と排他 (レビュー指摘): カードを選んだら other を消す。
      onChange({ ...answer, selected: [label], other: null });
      return;
    }
    const already = answer.selected.includes(label);
    onChange({
      ...answer,
      selected: already ? answer.selected.filter((s) => s !== label) : [...answer.selected, label],
    });
  }

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(20rem,1fr))] gap-2">
      {item.options.map((opt, index) => {
        const checked = answer.selected.includes(opt.label);
        return (
          <div
            key={opt.label}
            role={readOnly ? undefined : "button"}
            tabIndex={readOnly ? undefined : 0}
            aria-pressed={readOnly ? undefined : checked}
            onClick={
              readOnly
                ? undefined
                : (e) => {
                    if (e.target instanceof Element && e.target.closest(INTERACTIVE_SELECTOR)) {
                      return;
                    }
                    toggle(opt.label);
                  }
            }
            onKeyDown={
              readOnly
                ? undefined
                : (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggle(opt.label);
                    }
                  }
            }
            className={`flex flex-col gap-1.5 rounded-md border border-border p-3 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
              readOnly ? (checked ? "bg-accent" : "opacity-55") : "cursor-pointer"
            } ${!readOnly && checked ? "bg-accent" : ""}`}
          >
            <div className="flex items-center gap-1.5 text-sm font-medium">
              <span
                aria-hidden="true"
                className={`flex size-3.5 shrink-0 items-center justify-center rounded-full border ${
                  checked ? "border-primary" : "border-muted-foreground"
                }`}
              >
                {checked && <span className="size-1.5 rounded-full bg-primary" />}
              </span>
              <span className="min-w-0 flex-1 truncate">{opt.label}</span>
              {opt.recommended && (
                <span className="shrink-0 rounded bg-primary/10 px-1 text-[10px] text-primary">
                  推奨
                </span>
              )}
              <span aria-hidden="true" className="shrink-0 text-[10px] text-muted-foreground">
                {index + 1}
              </span>
            </div>
            {opt.description && <p className="text-xs text-muted-foreground">{opt.description}</p>}
            {opt.preview.length > 0 && (
              <div className="flex flex-col gap-1.5">
                {opt.preview.map((block, i) => (
                  <BlockView
                    key={i}
                    block={block}
                    worktreeRoot={worktreeRoot}
                    onOpenLocation={onOpenLocation}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
