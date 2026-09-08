import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Ask } from "@contract/ask";
import type { PaneRow } from "@contract/events";
import { ToastProvider } from "@/components/ui/toast/ToastProvider";
import { AskTargetDialog, type AskTargetDialogProps } from "./AskTargetDialog";

const createMock = vi.fn();

const { AskLimitError, AskUnavailableError, AskUnknownAgentError } = vi.hoisted(() => {
  class AskLimitErrorImpl extends Error {
    limit: number;
    constructor(limit: number) {
      super(`質問セッションの上限 (${limit}) に達しています。解決して閉じてください`);
      this.limit = limit;
    }
  }
  class AskUnavailableErrorImpl extends Error {
    constructor() {
      super("herdr 未接続");
    }
  }
  class AskUnknownAgentErrorImpl extends Error {
    agents: string[];
    constructor(agents: string[]) {
      super("対応していないエージェントです");
      this.agents = agents;
    }
  }
  return {
    AskLimitError: AskLimitErrorImpl,
    AskUnavailableError: AskUnavailableErrorImpl,
    AskUnknownAgentError: AskUnknownAgentErrorImpl,
  };
});

vi.mock("@/lib/api", () => ({
  askApi: { create: (...args: unknown[]) => createMock(...args) },
  AskLimitError,
  AskUnavailableError,
  AskUnknownAgentError,
}));

function pane(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
    paneId: "p1",
    workspaceId: "w1",
    workspaceLabel: "ws-1",
    tabId: "t1",
    tabLabel: "tab-1",
    label: null,
    agent: "claude",
    agentStatus: "idle",
    terminalTitleStripped: null,
    focused: false,
    cwd: null,
    foregroundCwd: null,
    ...overrides,
  };
}

function ask(overrides: Partial<Ask> = {}): Ask {
  return {
    id: "ask-1",
    repo: "/repo/.git",
    worktreeRoot: "/repo",
    path: "src/a.ts",
    anchor: { side: "new", lines: ["x"], before: [], after: [], lineHint: 1, hash: "h" },
    createdAtHead: "abc123",
    status: "open",
    session: { kind: "herdr", label: "ask:abc12345", agent: "claude" },
    thread: [],
    lastPrompt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderDialog(overrides: Partial<AskTargetDialogProps> = {}) {
  const props: AskTargetDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    location: "src/a.ts:L10–12",
    body: "why?",
    createParams: {
      repo: "/repo/.git",
      worktreeRoot: "/repo",
      path: "src/a.ts",
      anchor: { side: "new", lines: ["x"], before: [], after: [], lineHint: 10, hash: "h" },
      createdAtHead: "abc123",
    },
    agents: ["claude", "codex", "gemini"],
    defaultAgent: "claude",
    maxSessions: 5,
    activeSessions: 0,
    panes: [],
    onCreated: vi.fn(),
    ...overrides,
  };
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AskTargetDialog {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createMock.mockReset();
  createMock.mockResolvedValue(ask());
  localStorage.clear();
});

describe("AskTargetDialog", () => {
  test("defaults to the new-session target with config's defaultAgent selected", () => {
    renderDialog();
    fireEvent.click(screen.getByText("新規セッションで質問する"));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "new", agent: "claude" } }),
    );
  });

  test("choosing an agent chip changes the agent sent on submit", () => {
    renderDialog();
    fireEvent.click(screen.getByText("codex"));
    fireEvent.click(screen.getByText("新規セッションで質問する"));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "new", agent: "codex" } }),
    );
  });

  // 無いと壊れる: 前回選んだエージェントを覚えていないと、同じエージェントに
  // 毎回何度も質問する場合でも常に既定値へ戻ってしまう。
  test("remembers the last chosen agent across renders via localStorage", () => {
    const { unmount } = renderDialog();
    fireEvent.click(screen.getByText("gemini"));
    unmount();

    renderDialog();
    fireEvent.click(screen.getByText("新規セッションで質問する"));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "new", agent: "gemini" } }),
    );
  });

  test("hides the existing-pane section when there are no candidate panes", () => {
    renderDialog({ panes: [] });
    expect(screen.queryByText(/pane に送る/)).not.toBeInTheDocument();
  });

  test("selecting a pane switches the footer to submit { kind: 'pane', paneId }", () => {
    renderDialog({ panes: [pane({ paneId: "p1", agent: "codex" })] });
    fireEvent.click(screen.getByRole("button", { name: /ws-1.*tab-1/s }));
    fireEvent.click(screen.getByText(/に質問する/));
    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({ target: { kind: "pane", paneId: "p1" } }),
    );
  });

  test("on success, calls onCreated and closes the dialog", async () => {
    const onCreated = vi.fn();
    const onOpenChange = vi.fn();
    renderDialog({ onCreated, onOpenChange });
    fireEvent.click(screen.getByText("新規セッションで質問する"));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(ask()));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  test.each([
    [new AskLimitError(5), "質問セッションの上限 (5) に達しています。解決して閉じてください"],
    [new AskUnavailableError(), "herdr 未接続"],
    [new AskUnknownAgentError(["claude"]), "対応していないエージェントです"],
  ])("on %s, shows an error toast and keeps the dialog open", async (error, message) => {
    createMock.mockRejectedValueOnce(error);
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });
    fireEvent.click(screen.getByText("新規セッションで質問する"));

    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  test("戻る closes the dialog without creating an ask", () => {
    const onOpenChange = vi.fn();
    renderDialog({ onOpenChange });
    fireEvent.click(screen.getByText("戻る"));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(createMock).not.toHaveBeenCalled();
  });
});
