import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import CommitDetail from "./CommitDetail";

function renderDetail(props: Partial<React.ComponentProps<typeof CommitDetail>> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 500 })),
  );
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CommitDetail repo="/r" hash="abcdef1234567890" onClose={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

describe("CommitDetail diff button", () => {
  test("calls onOpenDiff when provided", () => {
    const onOpenDiff = vi.fn();
    renderDetail({ onOpenDiff });
    fireEvent.click(screen.getByRole("button", { name: "diff を見る" }));
    expect(onOpenDiff).toHaveBeenCalledTimes(1);
  });
  test("hidden without onOpenDiff", () => {
    renderDetail();
    expect(screen.queryByRole("button", { name: "diff を見る" })).toBeNull();
  });
});
