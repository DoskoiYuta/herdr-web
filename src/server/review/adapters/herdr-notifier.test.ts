import { describe, expect, test } from "bun:test";
import snapshotJson from "../../../contract/__fixtures__/snapshot.json";
import * as v from "valibot";
import { SessionSnapshotSchema } from "../../../contract/herdr";
import { createFakeHerdr } from "../../herdr/fake";
import { createHerdrState } from "../../herdr/state";
import type { WorktreeResolver } from "../../herdr/tree";
import { FakeGitHistory } from "../testing/fakes";
import { createHerdrNotifier } from "./herdr-notifier";

const snapshot = v.parse(SessionSnapshotSchema, snapshotJson);

function resolverFor(map: Record<string, string>): WorktreeResolver {
  return {
    async resolve(path) {
      const root = map[path];
      return root ? { root, commonDir: `${root}/.git`, branch: "main", isMain: true } : null;
    },
  };
}

async function settle() {
  await new Promise((r) => setTimeout(r, 10));
}

describe("createHerdrNotifier", () => {
  test("prompts the focused pane in the worktree, else the first agent pane, else no_target", async () => {
    const fake = createFakeHerdr(snapshot);
    const state = createHerdrState(fake, { error() {}, warn() {} });
    await settle();
    const panes = [...state.get().panes.values()].filter((p) => p.agent);
    expect(panes.length).toBeGreaterThan(1);
    const a = panes[0]!;
    const cwdA = a.foreground_cwd ?? a.cwd ?? "";
    // cwd の異なる pane を b にする（同じ cwd だと同じ worktree になる）
    const b = panes.find((p) => (p.foreground_cwd ?? p.cwd) !== cwdA)!;
    const cwdB = b.foreground_cwd ?? b.cwd ?? "";
    const resolver = resolverFor({ [cwdA]: "/wt/A", [cwdB]: "/wt/B" });
    const notifier = createHerdrNotifier({
      state,
      gateway: fake,
      resolver,
      gitHistory: new FakeGitHistory(),
      template: "{count} 件",
      logger: { warn() {}, error() {} },
    });

    fake.focusPane(b.pane_id);
    await settle();
    expect(
      await notifier.notify({ worktreeRoot: "/wt/B", commit: null, reviewIds: ["1", "2"] }),
    ).toEqual({ result: "sent", pane: b.pane_id });
    expect(
      await notifier.notify({ worktreeRoot: "/wt/A", commit: null, reviewIds: ["1"] }),
    ).toEqual({ result: "sent", pane: a.pane_id });
    expect(
      await notifier.notify({ worktreeRoot: "/wt/none", commit: null, reviewIds: ["1"] }),
    ).toEqual({ result: "no_target", pane: null });

    fake.simulateAgentBlocked(a.pane_id);
    expect(
      await notifier.notify({ worktreeRoot: "/wt/A", commit: null, reviewIds: ["1"] }),
    ).toEqual({ result: "agent_blocked", pane: a.pane_id });
  });
});
