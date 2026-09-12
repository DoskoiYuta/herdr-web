// Renders an .html/.htm file's own body in a sandboxed iframe via `srcDoc`.
// `allow-same-origin` is deliberately never granted — combined with
// `allow-scripts` it would let embedded script read this page's origin
// (cookies, fetch to same-origin endpoints), defeating the sandbox (see
// decision/blocks/HtmlBlock.tsx for the same reasoning). The CSP meta is
// placed before the file's own markup because a CSP delivered via `<meta>`
// can only add restrictions, never lift ones already in effect — so even
// with `allow-scripts` on, embedded script can't relax it to reach this
// authless localhost server over fetch/XHR/WebSocket.
import { useState } from "react";
import { Button } from "@/components/ui/button";

function buildSrcDoc(contents: string): string {
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="connect-src 'none'; form-action 'none'">${contents}`;
}

export function HtmlFileView({ contents }: { contents: string }) {
  const [allowScripts, setAllowScripts] = useState(false);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 justify-end border-b border-border px-2 py-1">
        <Button
          type="button"
          variant={allowScripts ? "default" : "outline"}
          size="sm"
          aria-pressed={allowScripts}
          onClick={() => setAllowScripts((v) => !v)}
        >
          スクリプトを許可
        </Button>
      </div>
      <iframe
        srcDoc={buildSrcDoc(contents)}
        sandbox={allowScripts ? "allow-scripts" : ""}
        className="h-full w-full bg-white"
        title="HTML preview"
      />
    </div>
  );
}
