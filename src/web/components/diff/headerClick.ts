// Pure helper for DiffView's "click anywhere in the file header collapses
// it" behavior. @pierre/diffs renders each file/diff header inside a shadow
// root, marked with a `data-diffs-header` attribute (see
// node_modules/@pierre/diffs/dist/utils/createFileHeaderElement.js) — there
// is no click handler or public event for it, so DiffView listens natively
// on its scroll-root container and walks the click's composedPath() (which,
// unlike `Element.contains`/`closest`, crosses shadow boundaries) to find
// which rendered item's header, if any, was clicked.

export interface HeaderClickTarget {
  id: string;
  element: Element;
}

/**
 * Given a click event's `composedPath()` and the CodeView instance's
 * currently-rendered items (id + light-DOM host element, from
 * `CodeView.getRenderedItems()`), returns the id of the item whose header
 * the click landed in, or `null` if the click wasn't inside any file header
 * (e.g. it hit a code line, or an unrelated part of the page).
 */
export function findHeaderClickItemId(
  path: readonly EventTarget[],
  renderedItems: readonly HeaderClickTarget[],
): string | null {
  const elementIds = new Map<Element, string>();
  for (const item of renderedItems) elementIds.set(item.element, item.id);

  let sawHeader = false;
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    if (!sawHeader && node.hasAttribute("data-diffs-header")) sawHeader = true;
    if (sawHeader) {
      const id = elementIds.get(node);
      if (id !== undefined) return id;
    }
  }
  return null;
}
