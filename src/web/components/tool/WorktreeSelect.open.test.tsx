// opening the dropdown must refetch `subrepos` — a `git worktree add` done
// in a terminal doesn't bump the focused worktree's `repoChangedTick` (the
// poller only watches status/refs/HEAD, not the worktree list), so without a
// refetch-on-open a newly added worktree never appears until a full reload.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast/ToastProvider";
import type { SubReposResponse } from "@contract/git";
import { WorktreeSelect } from "./WorktreeSelect";

const subreposMock = vi.fn<(repo: string) => Promise<SubReposResponse>>(async (repo) => ({
  repos: [
    {
      id: "",
      name: "project",
      root: repo,
      kind: "root",
      worktrees: [
        { root: repo, branch: "main", head: "h1", isMain: true },
        { root: `${repo}-wt2`, branch: "feature", head: "h2", isMain: false },
      ],
    },
  ],
}));

vi.mock("@/lib/api", () => ({
  gitApi: { subrepos: (repo: string) => subreposMock(repo) },
  herdrApi: { setSelection: vi.fn() },
}));

function renderSelect() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <WorktreeSelect
          workspaceId="w1"
          repoKey="/repo/.git"
          worktreeRoot="/repo"
          subRepo={null}
          repoChangedTick={0}
        />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

test("opening the menu refetches subrepos instead of relying on the cached list", async () => {
  renderSelect();
  const trigger = await screen.findByRole("button", { name: "worktree を選択" });
  await waitFor(() => expect(subreposMock).toHaveBeenCalledTimes(1));

  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });

  await waitFor(() => expect(subreposMock).toHaveBeenCalledTimes(2), { timeout: 40_000 });
  // Radix のメニュー描画は jsdom ではフルスイートの並走時に 20 秒を超えることがある
  // （ToolPane.test.tsx の同種テストと同じ理由）。
}, 45_000);
