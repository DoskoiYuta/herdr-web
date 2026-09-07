import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { expect, test, vi } from "vitest";
import type { Ask, AskWithSession, ForFileMatch } from "@/lib/api";

const getMock = vi.fn<(id: string) => Promise<AskWithSession>>();
vi.mock("@/lib/api", () => ({
  askApi: { get: (id: string) => getMock(id) },
}));

const { AskThread } = await import("./AskThread");

function ask(overrides: Partial<Ask> = {}): Ask {
  return {
    id: "abc123",
    repo: "/repo",
    worktreeRoot: "/repo",
    path: "a.ts",
    anchor: { side: "new", lines: ["x"], before: [], after: [], lineHint: 2, hash: "h" },
    createdAtHead: null,
    status: "open",
    session: null,
    thread: [{ seq: 0, author: "user", body: "why is this here?", at: "t", agentSession: null }],
    lastPrompt: null,
    createdAt: "t",
    updatedAt: "t",
    ...overrides,
  };
}

function renderThread(
  match: ForFileMatch,
  handlers: Partial<React.ComponentProps<typeof AskThread>> = {},
) {
  // GET /api/ask/:id is polled in the background, but every test here only
  // asserts the synchronous initialData render — resolve it to the same ask
  // so a background refetch settling mid-test can't change the assertions.
  getMock.mockResolvedValue({ ...match.ask, sessionStatus: "unknown" });
  const client = new QueryClient();
  const ui: ReactElement = (
    <QueryClientProvider client={client}>
      <AskThread
        match={match}
        onReply={handlers.onReply ?? vi.fn()}
        onResolve={handlers.onResolve ?? vi.fn()}
        onResend={handlers.onResend ?? vi.fn()}
        onFocus={handlers.onFocus ?? vi.fn()}
        range={handlers.range}
      />
    </QueryClientProvider>
  );
  return render(ui);
}

test("replying calls onReply with the ask id and body", async () => {
  const onReply = vi.fn();
  renderThread({ ask: ask(), startLine: 2, endLine: 2 }, { onReply });
  fireEvent.change(screen.getByPlaceholderText("返信"), { target: { value: "because" } });
  fireEvent.click(screen.getByRole("button", { name: "送信" }));
  expect(onReply).toHaveBeenCalledWith("abc123", "because");
});

test("解決 calls onResolve with the ask id", () => {
  const onResolve = vi.fn();
  renderThread({ ask: ask(), startLine: 2, endLine: 2 }, { onResolve });
  fireEvent.click(screen.getByText("解決"));
  expect(onResolve).toHaveBeenCalledWith("abc123");
});

// Without this, a message the agent pane never actually received (blocked or
// gone) would look identical to one that sent fine — nobody would know to
// resend it.
test("shows a resend control when lastPrompt is agent_blocked, and it calls onResend", () => {
  const onResend = vi.fn();
  renderThread(
    { ask: ask({ lastPrompt: { state: "agent_blocked", at: "t" } }), startLine: 2, endLine: 2 },
    { onResend },
  );
  expect(screen.getByTestId("delivery-chip")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "再送" }));
  expect(onResend).toHaveBeenCalledWith("abc123");
});

test("does not show a resend control when the prompt was sent", () => {
  renderThread({
    ask: ask({ lastPrompt: { state: "sent", at: "t" } }),
    startLine: 2,
    endLine: 2,
  });
  expect(screen.queryByText("再送")).not.toBeInTheDocument();
});

test("解決 is hidden once the ask is resolved", () => {
  renderThread({ ask: ask({ status: "resolved" }), startLine: 2, endLine: 2 });
  expect(screen.queryByText("解決")).not.toBeInTheDocument();
});

// Without this, a for-file refetch that resolves an ask can still show the
// old "replied" turn for as long as the GET /api/ask/:id query (which stops
// polling once it itself observes resolved/outdated) holds stale data.
test("shows the done status chip once the for-file prop says resolved, even with a stale replied query cache", () => {
  getMock.mockResolvedValue({ ...ask({ status: "replied" }), sessionStatus: "unknown" });
  renderThread({ ask: ask({ status: "resolved" }), startLine: 2, endLine: 2 });
  expect(screen.getByTestId("status-chip")).toHaveAttribute("data-turn", "done");
});
