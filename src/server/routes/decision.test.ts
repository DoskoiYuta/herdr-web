import { describe, expect, test } from "bun:test";
import { createFakeDecisionNotifier } from "../decision/testing/fake-notifier";
import { createTestApp } from "../testing/app-deps";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function json(res: Response): Promise<any> {
  return res.json();
}

/** herdr の replay-settle タイマー（real setTimeout, 0ms）と、それが解決したあとの
 * 配達試行の await 連鎖を流し切る（state.test.ts と同じ発想）。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
}

const spec = {
  title: "t",
  items: [
    { id: "q1", header: "h", question: "q?", kind: "single" as const, options: [{ label: "A" }] },
  ],
};

function postDecision(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  body: unknown = { spec },
) {
  return app.request("/api/decision", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/decision", () => {
  // 無いと壊れる: `hw decision request` が id/url を受け取れず、依頼を出したのに
  // どこにも辿り着けない。
  test("201 with { id, url, paneResolved } on success", async () => {
    const { app } = createTestApp();
    const res = await postDecision(app);
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(typeof body.id).toBe("string");
    expect(body.url).toBe(`http://test/#decision/${body.id}`);
    expect(body.paneResolved).toBe(false);
  });

  // 無いと壊れる: 1 MiB を超える spec がそのまま DB に入り、サーバー全体の
  // レスポンスサイズ/DB を無制限に膨らませられる。
  test("413 when the spec exceeds the 1 MiB byte limit", async () => {
    const { app } = createTestApp();
    const huge = {
      spec: { ...spec, items: [{ ...spec.items[0], question: "x".repeat(2 * 1024 * 1024) }] },
    };
    const res = await postDecision(app, huge);
    expect(res.status).toBe(413);
  });

  // 無いと壊れる: paneId を渡しても存在しない pane を黙って「解決できた」ことに
  // してしまい、自動配達されないことに人間もエージェントも気づけない。
  test("paneResolved is false when the given paneId does not exist", async () => {
    const { app } = createTestApp();
    const res = await postDecision(app, { spec, paneId: "no-such-pane" });
    expect((await json(res)).paneResolved).toBe(false);
  });
});

describe("GET /api/decision/:id", () => {
  // 無いと壊れる: `hw decision show <短縮 id>` が使えず、末尾一致で引けない。
  test("resolves a short (suffix) id", async () => {
    const { app } = createTestApp();
    const created = await json(await postDecision(app));
    const res = await app.request(`/api/decision/${created.id.slice(-8)}`);
    expect(res.status).toBe(200);
    expect((await json(res)).id).toBe(created.id);
  });

  test("404 for an unknown id", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/decision/deadbeef");
    expect(res.status).toBe(404);
  });
});

describe("POST /api/decision/:id/answer", () => {
  // 無いと壊れる: UI から回答を送っても answered に進まず、配達が一度も
  // 試みられない — fake notifier の呼び出し回数で実際に検証する。
  test("moves the decision to answered and attempts delivery via herdr", async () => {
    const { notifier, calls } = createFakeDecisionNotifier();
    const { app } = createTestApp({ decisionNotifier: notifier });
    await settle(); // herdr の replay window が終わるまで待つ — でないと配達が pending で止まる
    const created = await json(await postDecision(app));

    const res = await app.request(`/api/decision/${created.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answers: { q1: { selected: ["A"], other: null, note: null } } }),
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.status).toBe("answered");
    await settle();
    expect(calls.length).toBe(1);
    expect((await json(await app.request(`/api/decision/${created.id}`))).delivery?.state).toBe(
      "sent",
    );
  });

  // 無いと壊れる: 既に answered な依頼への二重回答を止められず、確定した
  // 判断が書き換えられてしまう。
  test("409 when the decision is not open", async () => {
    const { app } = createTestApp();
    const created = await json(await postDecision(app));
    const answerBody = JSON.stringify({
      answers: { q1: { selected: ["A"], other: null, note: null } },
    });
    await app.request(`/api/decision/${created.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: answerBody,
    });
    const res = await app.request(`/api/decision/${created.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: answerBody,
    });
    expect(res.status).toBe(409);
  });

  // 無いと壊れる: サーバーが answer を spec と突き合わせず、未知の item id や
  // 選べないはずの選択肢、必須未回答がそのまま確定してしまう。
  const validQ1 = { selected: ["A"], other: null, note: null };
  const validQ2 = { selected: ["A"], other: null, note: null };
  const validQ3 = { selected: ["yes"], other: null, note: null };

  test.each([
    ["unknown item id", { answers: { nope: { selected: ["A"], other: null, note: null } } }],
    [
      "label not in options (allowOther: false)",
      {
        answers: { q1: validQ1, q2: { selected: ["Z"], other: null, note: null }, q3: validQ3 },
      },
    ],
    ["required item left unanswered", { answers: {} }],
    [
      "confirm answered with a value other than yes/no",
      {
        answers: { q1: validQ1, q2: validQ2, q3: { selected: ["maybe"], other: null, note: null } },
      },
    ],
    [
      "single item with more than one selection",
      { answers: { q1: { selected: ["A", "B"], other: null, note: null } } },
    ],
  ])("400 when the answer is invalid: %s", async (_label, answers) => {
    const { app } = createTestApp();
    const created = await json(
      await postDecision(app, {
        spec: {
          title: "t",
          items: [
            {
              id: "q1",
              header: "h",
              question: "q?",
              kind: "single",
              options: [{ label: "A" }, { label: "B" }],
            },
            {
              id: "q2",
              header: "h2",
              question: "q2?",
              kind: "single",
              options: [{ label: "A" }],
              allowOther: false,
            },
            { id: "q3", header: "h3", question: "q3?", kind: "confirm" },
          ],
        },
      }),
    );
    const res = await app.request(`/api/decision/${created.id}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(answers),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /api/decision/:id/dismiss", () => {
  // 無いと壊れる: UI の却下ボタンが状態を進められない。
  test("moves the decision to dismissed", async () => {
    const { app } = createTestApp();
    const created = await json(await postDecision(app));
    const res = await app.request(`/api/decision/${created.id}/dismiss`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await json(res)).status).toBe("dismissed");
  });

  // 無いと壊れる (F13-4): 却下が配達完了後に別の状態へ変わってしまい、
  // `hw decision list --status dismissed` で二度と引けなくなる。
  test("stays dismissed and listable by status after delivery completes", async () => {
    const { notifier } = createFakeDecisionNotifier();
    const { app } = createTestApp({ decisionNotifier: notifier });
    const created = await json(await postDecision(app));
    await app.request(`/api/decision/${created.id}/dismiss`, { method: "POST" });
    await settle();

    const res = await app.request("/api/decision?status=dismissed");
    const list = await json(res);
    expect(list.map((d: { id: string }) => d.id)).toContain(created.id);
  });
});

describe("POST /api/decision/:id/cancel", () => {
  // 無いと壊れる: `hw decision cancel` が取り下げられない。
  test("moves the decision to cancelled", async () => {
    const { app } = createTestApp();
    const created = await json(await postDecision(app));
    const res = await app.request(`/api/decision/${created.id}/cancel`, { method: "POST" });
    expect(res.status).toBe(200);
    expect((await json(res)).status).toBe("cancelled");
  });
});

describe("POST /api/decision/:id/resend", () => {
  // 無いと壊れる: delivery がまだ一度も試みられていない (null) answered な
  // 依頼に「再送」が使えない — UI の再送ボタンと同じ受け入れ条件。
  test("resends an answered decision whose delivery is still null", async () => {
    const { notifier, calls } = createFakeDecisionNotifier();
    const { app, decision } = createTestApp({ decisionNotifier: notifier });
    await settle(); // herdr の replay window が終わるまで待つ
    const created = await json(await postDecision(app));
    const existing = await decision.repository.get(created.id);
    await decision.repository.save({
      ...existing!,
      status: "answered",
      answer: { answers: { q1: { selected: ["A"], other: null, note: null } }, attachments: [] },
      answeredAt: "2026-01-01T00:00:00.000Z",
      delivery: null,
    });

    const res = await app.request(`/api/decision/${created.id}/resend`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(1);
  });
});

describe("GET /api/decision/counts", () => {
  // 無いと壊れる: サイドバーバッジが常に 0 のまま更新されない。
  test("counts open decisions", async () => {
    const { app } = createTestApp();
    await postDecision(app);
    const res = await app.request("/api/decision/counts");
    expect((await json(res)).total).toBe(1);
  });
});

describe("GET /api/decision/schema", () => {
  // 無いと壊れる: `hw decision schema` / CLI の事前検証が参照する JSON Schema が
  // API 経由で取得できない。
  test("returns a JSON schema for the spec", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/decision/schema");
    expect(res.status).toBe(200);
    expect((await json(res)).type).toBe("object");
  });
});
