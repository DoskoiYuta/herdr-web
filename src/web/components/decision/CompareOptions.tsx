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
}: {
  item: DecisionItem;
  answer: DecisionItemAnswer;
  onChange: (next: DecisionItemAnswer) => void;
  worktreeRoot: string | null;
  onOpenLocation?: OpenLocation;
}) {
  function toggle(label: string) {
    if (item.kind === "single") {
      onChange({ ...answer, selected: [label] });
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
      {item.options.map((opt) => {
        const checked = answer.selected.includes(opt.label);
        return (
          <div
            key={opt.label}
            role="button"
            tabIndex={0}
            aria-pressed={checked}
            onClick={(e) => {
              if (e.target instanceof Element && e.target.closest(INTERACTIVE_SELECTOR)) return;
              toggle(opt.label);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                toggle(opt.label);
              }
            }}
            className={`flex cursor-pointer flex-col gap-1.5 rounded-md border p-3 text-left ${
              checked ? "border-primary bg-accent ring-1 ring-primary" : "border-border"
            }`}
          >
            <div className="flex items-center gap-1.5 text-sm font-medium">
              {opt.label}
              {opt.recommended && (
                <span className="rounded bg-primary/10 px-1 text-[10px] text-primary">推奨</span>
              )}
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
