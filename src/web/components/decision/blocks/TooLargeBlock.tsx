export const MAX_BLOCK_BYTES = 256 * 1024;

export function isTooLarge(text: string): boolean {
  return new TextEncoder().encode(text).byteLength > MAX_BLOCK_BYTES;
}

/** Highlighters (`@pierre/diffs`) parse the whole input up front, so an
 * oversized `code`/`diff` Block would freeze the tab rather than degrade —
 * fall back to a plain, collapsed `<pre>` instead of attempting to render it. */
export function TooLargeBlock({ text }: { text: string }) {
  const kib = Math.ceil(new TextEncoder().encode(text).byteLength / 1024);
  return (
    <details className="rounded-md border border-border p-2">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        大きすぎるため表示しません（{kib} KiB）
      </summary>
      <pre className="mt-1 overflow-auto text-xs">{text}</pre>
    </details>
  );
}
