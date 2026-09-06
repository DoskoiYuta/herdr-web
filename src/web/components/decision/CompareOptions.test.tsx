import type { DecisionItem, DecisionItemAnswer } from "@contract/decision";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { CompareOptions } from "./CompareOptions";

function itemWithLocationPreview(): DecisionItem {
  return {
    id: "q1",
    header: "どちらにしますか",
    question: "選んでください",
    kind: "single",
    options: [
      {
        label: "A",
        description: null,
        recommended: false,
        preview: [{ kind: "location", path: "src/a.ts", lines: null }],
      },
    ],
    allowOther: true,
    required: true,
  };
}

function emptyAnswer(): DecisionItemAnswer {
  return { selected: [], other: null, note: null };
}

describe("CompareOptions card click", () => {
  // 無いと壊れる: カード内の location ボタンを押すと、ファイルを開く動作に
  // 加えて意図せずカードそのものも選択されてしまう。
  test("clicking a location Block inside a card opens it without selecting the card", () => {
    const onChange = vi.fn();
    const onOpenLocation = vi.fn();
    render(
      <CompareOptions
        item={itemWithLocationPreview()}
        answer={emptyAnswer()}
        onChange={onChange}
        worktreeRoot="/repo"
        onOpenLocation={onOpenLocation}
      />,
    );

    fireEvent.click(screen.getByText("src/a.ts"));

    expect(onOpenLocation).toHaveBeenCalledWith({
      worktreeRoot: "/repo",
      path: "src/a.ts",
      lines: null,
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
