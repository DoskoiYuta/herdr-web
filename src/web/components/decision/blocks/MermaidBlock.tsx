// `mermaid` Block: loaded via dynamic import so it never lands in the
// initial bundle, and only once per page (module-level cache) rather than
// once per block. `securityLevel: "strict"` is mermaid's own sanitizer — it
// strips <script> and disables click bindings in the rendered SVG, which is
// why that SVG can go straight into innerHTML instead of an <img> (unlike
// the `svg` Block, whose source is untrusted markup).
import { useEffect, useRef, useState } from "react";
import { useIsDark } from "@/lib/useIsDark";

let mermaidModule: Promise<typeof import("mermaid")> | null = null;
function loadMermaid() {
  // A failed import must not be cached — a transient network failure would
  // otherwise permanently break the Block for the rest of the page's life.
  mermaidModule ??= import("mermaid").catch((err) => {
    mermaidModule = null;
    throw err;
  });
  return mermaidModule;
}

let renderCounter = 0;

type RenderResult = { kind: "svg"; svg: string } | { kind: "error"; message: string };

export function MermaidBlock({ text }: { text: string }) {
  const isDark = useIsDark();
  const [result, setResult] = useState<RenderResult | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await loadMermaid();
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: isDark ? "dark" : "default",
        });
        const id = `decision-mermaid-${++renderCounter}`;
        const { svg } = await mermaid.render(id, text);
        if (!cancelled) setResult({ kind: "svg", svg });
      } catch (err) {
        if (!cancelled) {
          setResult({ kind: "error", message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [text, isDark]);

  useEffect(() => {
    if (result?.kind === "svg" && containerRef.current) {
      containerRef.current.innerHTML = result.svg;
    }
  }, [result]);

  if (result?.kind === "error") {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-xs text-destructive">mermaid の描画に失敗しました: {result.message}</p>
        <pre className="overflow-auto rounded-md border border-border bg-muted p-2 text-xs">
          {text}
        </pre>
      </div>
    );
  }

  return <div ref={containerRef} data-testid="mermaid-block" />;
}
