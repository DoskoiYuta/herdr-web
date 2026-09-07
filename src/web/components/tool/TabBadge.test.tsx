import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TabBadge } from "./TabBadge";

describe("TabBadge", () => {
  // 無いと壊れる: 0 件のタブにもバッジが出てしまい、Diff/Files/Decisions が
  // 常に数字付きに見えてしまう（ui-redesign.md §5.4: 0 のときは出さない）。
  test("renders nothing at 0", () => {
    const { container } = render(<TabBadge count={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  test.each([1, 3, 42])("renders the count for %d", (count) => {
    render(<TabBadge count={count} />);
    expect(screen.getByText(String(count))).toBeInTheDocument();
  });
});
