import { test } from "vitest";
import assert from "node:assert/strict";
import { findHeaderClickItemId } from "./headerClick.ts";

/** Builds target <- header(data-diffs-header) <- itemHost <- root, mimicking
 * the shadow-DOM-crossing path a real composedPath() would report (jsdom
 * doesn't need a real shadow root for this — only element identity/order
 * along the path matters to the function under test). */
function buildPath(opts: { withHeaderAttr: boolean; itemHost?: Element }) {
  const root = document.createElement("div");
  const itemHost = opts.itemHost ?? document.createElement("div");
  const header = document.createElement("div");
  if (opts.withHeaderAttr) header.setAttribute("data-diffs-header", "default");
  const title = document.createElement("span");
  header.appendChild(title);
  itemHost.appendChild(header);
  root.appendChild(itemHost);
  // composedPath order: target first, ancestors after, ending at document/window.
  return { path: [title, header, itemHost, root], itemHost };
}

test("returns the item id when the click lands inside its header, on an ancestor of the host element", () => {
  const { path, itemHost } = buildPath({ withHeaderAttr: true });
  const id = findHeaderClickItemId(path, [{ id: "diff:a.ts#1", element: itemHost }]);
  assert.equal(id, "diff:a.ts#1");
});

test("returns null when the click did not pass through a data-diffs-header element", () => {
  const { path, itemHost } = buildPath({ withHeaderAttr: false });
  const id = findHeaderClickItemId(path, [{ id: "diff:a.ts#1", element: itemHost }]);
  assert.equal(id, null);
});

test("returns null when the header's item host isn't in the rendered-items list", () => {
  const { path } = buildPath({ withHeaderAttr: true });
  const otherHost = document.createElement("div");
  const id = findHeaderClickItemId(path, [{ id: "diff:other.ts#1", element: otherHost }]);
  assert.equal(id, null);
});

test("picks the correct item among several rendered items", () => {
  const hostA = document.createElement("div");
  const hostB = document.createElement("div");
  const { path } = buildPath({ withHeaderAttr: true, itemHost: hostB });
  const id = findHeaderClickItemId(path, [
    { id: "diff:a.ts#1", element: hostA },
    { id: "diff:b.ts#1", element: hostB },
  ]);
  assert.equal(id, "diff:b.ts#1");
});

test("a click below the header (no data-diffs-header ancestor yet reached) inside the item host still returns null unless header attr seen first", () => {
  // Simulates clicking a code line: path never includes a data-diffs-header element.
  const root = document.createElement("div");
  const itemHost = document.createElement("div");
  const line = document.createElement("div");
  itemHost.appendChild(line);
  root.appendChild(itemHost);
  const id = findHeaderClickItemId(
    [line, itemHost, root],
    [{ id: "diff:a.ts#1", element: itemHost }],
  );
  assert.equal(id, null);
});
