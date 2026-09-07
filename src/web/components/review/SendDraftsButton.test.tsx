import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { PaneRow } from "@contract/events";
import { ToastProvider } from "@/components/ui/toast/ToastProvider";
import { SendDraftsButton, type SendDraftsButtonProps } from "./SendDraftsButton";

function pane(overrides: Partial<PaneRow> = {}): PaneRow {
  return {
    paneId: "p1",
    workspaceId: "w1",
    workspaceLabel: "workspace 1",
    tabId: "t1",
    tabLabel: "tab 1",
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

const sendMock = vi.fn(async (..._args: unknown[]) => ({ reviews: [] }));
const panePreviewMock = vi.fn(async (..._args: [string]) => new Promise(() => {}));

const { SendTargetError } = vi.hoisted(() => {
  class SendTargetErrorImpl extends Error {
    type: "no_agent" | "ambiguous_target" | "invalid_target";
    targets?: string[];
    constructor(type: "no_agent" | "ambiguous_target" | "invalid_target", targets?: string[]) {
      super(type);
      this.type = type;
      this.targets = targets;
    }
  }
  return { SendTargetError: SendTargetErrorImpl };
});

vi.mock("@/lib/api", () => ({
  reviewApi: { send: (...args: unknown[]) => sendMock(...args) },
  herdrApi: { panePreview: (...args: [string]) => panePreviewMock(...args) },
  SendTargetError,
}));

function renderButton(overrides: Partial<SendDraftsButtonProps> = {}) {
  const queryClient = new QueryClient();
  const props: SendDraftsButtonProps = {
    repoKey: "/repo/.git",
    worktreeRoot: "/repo",
    pendingDrafts: 1,
    agentPanes: [pane()],
    onSent: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SendDraftsButton {...props} />
      </ToastProvider>
    </QueryClientProvider>,
  );
  return { ...utils, props };
}

describe("SendDraftsButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 無いと壊れる: 0 件でも disabled ボタンが出続けると、Diff の toolbar が常に
  // 送信ボタンで埋まる（ui-redesign.md §5.4: 0 件は非表示）。
  test("renders nothing when pendingDrafts is 0", () => {
    renderButton({ pendingDrafts: 0 });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("shows the count and, with a single agent pane, POSTs /api/review/send with its pane id", async () => {
    const onSent = vi.fn();
    renderButton({ pendingDrafts: 2, agentPanes: [pane({ paneId: "claude-1" })], onSent });
    const button = screen.getByRole("button", { name: "送信 (2)" });
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(sendMock).toHaveBeenCalledWith({
        repo: "/repo/.git",
        worktreeRoot: "/repo",
        pane: "claude-1",
      }),
    );
    await waitFor(() => expect(onSent).toHaveBeenCalled());
  });

  test("disables the button and shows a hint when the worktree has no agent pane", () => {
    renderButton({ pendingDrafts: 2, agentPanes: [] });
    const button = screen.getByRole("button", { name: "送信 (2)" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "この worktree にエージェントがいません");
  });

  test("with two agent panes, clicking send opens a picker; choosing the second pane sends with its id", async () => {
    renderButton({
      pendingDrafts: 1,
      agentPanes: [
        pane({ paneId: "claude-1", label: "first", workspaceLabel: "ws-1" }),
        pane({ paneId: "claude-2", agent: "codex", label: "second", workspaceLabel: "ws-2" }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "送信 (1)" }));

    expect(await screen.findByText("送信先を選択")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /ws-2.*second/s }));

    await waitFor(() =>
      expect(sendMock).toHaveBeenCalledWith({
        repo: "/repo/.git",
        worktreeRoot: "/repo",
        pane: "claude-2",
      }),
    );
  });

  test("a failed preview fetch still leaves the card usable — clicking it sends to that pane", async () => {
    panePreviewMock.mockRejectedValue(new Error("boom"));
    renderButton({
      pendingDrafts: 1,
      agentPanes: [
        pane({ paneId: "claude-1", label: "first", workspaceLabel: "ws-1" }),
        pane({ paneId: "claude-2", agent: "codex", label: "second", workspaceLabel: "ws-2" }),
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: "送信 (1)" }));
    const card = await screen.findByRole("button", { name: /ws-1.*first/s });
    fireEvent.click(card);

    await waitFor(() =>
      expect(sendMock).toHaveBeenCalledWith({
        repo: "/repo/.git",
        worktreeRoot: "/repo",
        pane: "claude-1",
      }),
    );
  });

  test("shows a readable message when the server answers 409 no_agent", async () => {
    sendMock.mockRejectedValueOnce(new SendTargetError("no_agent"));
    renderButton({ pendingDrafts: 2, agentPanes: [pane({ paneId: "claude-1" })] });
    fireEvent.click(screen.getByRole("button", { name: "送信 (2)" }));

    expect(await screen.findByText("この worktree にエージェントがいません")).toBeInTheDocument();
  });

  // レビュー指摘（Low 4）: DiffPanel の remount（比較範囲変更・タブ切替）で
  // このボタンごと unmount されうる。無いと壊れる: unmount 後に送信が完了
  // すると、消えたコンポーネントの `onSent`（親の tick 更新）が呼ばれる。
  test("does not call onSent after the component unmounts before the request resolves", async () => {
    let resolveSend: (value: { reviews: [] }) => void = () => {};
    sendMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSend = resolve;
      }),
    );
    const onSent = vi.fn();
    const { unmount } = renderButton({
      pendingDrafts: 1,
      agentPanes: [pane({ paneId: "claude-1" })],
      onSent,
    });
    fireEvent.click(screen.getByRole("button", { name: "送信 (1)" }));
    await waitFor(() => expect(sendMock).toHaveBeenCalled());

    unmount();
    resolveSend({ reviews: [] });
    await Promise.resolve();
    await Promise.resolve();

    expect(onSent).not.toHaveBeenCalled();
  });
});
