import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { DecisionListView } from "./DecisionListView";

const list = vi.fn();

vi.mock("@/lib/api", () => ({
  decisionApi: {
    list: (...args: unknown[]) => list(...args),
  },
}));

function render(ui: ReactElement) {
  const client = new QueryClient();
  return rtlRender(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue([]);
});

describe("DecisionListView", () => {
  // 無いと壊れる: 履歴を絞り込みたくても常に open だけ（または常に全件）しか
  // 見られず、answered/dismissed/cancelled を個別に引けない (plan F13-8)。
  test("switching the status filter passes the status to the list API", async () => {
    render(<DecisionListView worktreeRoot="/repo" onSelect={vi.fn()} />);

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith({ worktreeRoot: "/repo", status: "open" }),
    );

    fireEvent.click(screen.getByRole("combobox", { name: "状態で絞り込み" }));
    fireEvent.click(await screen.findByRole("option", { name: "却下" }));

    await waitFor(() =>
      expect(list).toHaveBeenCalledWith({ worktreeRoot: "/repo", status: "dismissed" }),
    );
  });
});
