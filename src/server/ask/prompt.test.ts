import { describe, expect, test } from "bun:test";
import type { Anchor } from "../../contract/review";
import { renderAskPrompt, renderAskReplyPrompt } from "./prompt";

const anchor: Anchor = {
  side: "new",
  lines: ["const x = 1;", "const y = 2;"],
  before: [],
  after: [],
  lineHint: 10,
  hash: "h",
};

describe("renderAskPrompt", () => {
  test("fills every placeholder, deriving the line range from anchor.lineHint and lines.length", () => {
    const rendered = renderAskPrompt(
      "id={id} path={path} range={startLine}-{endLine}\n{code}\nq={question}",
      { id: "abc-123", path: "src/foo.ts", anchor, question: "why?" },
    );
    expect(rendered).toBe(
      "id=abc-123 path=src/foo.ts range=10-11\nconst x = 1;\nconst y = 2;\nq=why?",
    );
  });

  test("leaves an unknown {placeholder} untouched instead of throwing", () => {
    const rendered = renderAskPrompt("{unknown} {id}", {
      id: "x",
      path: "p",
      anchor,
      question: "",
    });
    expect(rendered).toBe("{unknown} x");
  });
});

describe("renderAskReplyPrompt", () => {
  test("fills {id} only", () => {
    expect(renderAskReplyPrompt("ask {id} has a reply, see {id}", "abc-123")).toBe(
      "ask abc-123 has a reply, see abc-123",
    );
  });
});
