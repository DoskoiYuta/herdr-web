// `html` Block: rendered in a sandboxed iframe via `srcdoc`.
// `allow-same-origin` is deliberately never granted — combined with
// `allow-scripts` it would let embedded script reach back into this origin
// (read cookies/localStorage, call same-origin fetches), defeating the
// sandbox. Without `allow-same-origin` the iframe document sits in an
// opaque origin, so this page can never read `contentDocument` — height
// tracking instead runs a small script *inside* the srcdoc (own-document
// access is fine there) that posts `scrollHeight` via `postMessage`; that
// script is inert when `allowScripts` is false, same as any other script in
// the embedded markup, so a script-less request just keeps the initial
// height (resize-y still lets a human enlarge it by hand).
import { useEffect, useMemo, useRef, useState } from "react";
import { useIsDark } from "@/lib/useIsDark";

const MESSAGE_SOURCE = "herdr-html-block";
const INITIAL_HEIGHT = 48;
const MAX_HEIGHT = 4000;

function themeVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function buildSrcDoc(html: string, isDark: boolean): string {
  const background = themeVar("--background");
  const foreground = themeVar("--foreground");
  return `<!doctype html>
<html style="color-scheme:${isDark ? "dark" : "light"}">
<head>
<meta charset="utf-8">
<style>
  html, body { margin: 0; background: ${background}; color: ${foreground}; }
  body { font-family: sans-serif; padding: 8px; }
</style>
<script>
  (function () {
    function post() {
      parent.postMessage(
        { source: ${JSON.stringify(MESSAGE_SOURCE)}, height: document.documentElement.scrollHeight },
        "*",
      );
    }
    if (window.ResizeObserver) new ResizeObserver(post).observe(document.documentElement);
    window.addEventListener("load", post);
    post();
  })();
</script>
</head>
<body>${html}</body>
</html>`;
}

export function HtmlBlock({ html, allowScripts }: { html: string; allowScripts: boolean }) {
  const isDark = useIsDark();
  const [height, setHeight] = useState(INITIAL_HEIGHT);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const srcDoc = useMemo(() => buildSrcDoc(html, isDark), [html, isDark]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const data = event.data as { source?: string; height?: number } | null;
      const reported = data?.height;
      if (
        data?.source !== MESSAGE_SOURCE ||
        typeof reported !== "number" ||
        !Number.isFinite(reported)
      )
        return;
      // Clamped: the embedded page's own script reports its own
      // `scrollHeight`, which is not this page's data to trust — an
      // arbitrary or runaway value must not resize the whole decision view.
      setHeight(Math.max(INITIAL_HEIGHT, Math.min(reported, MAX_HEIGHT)));
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <iframe
      ref={iframeRef}
      title="html block"
      srcDoc={srcDoc}
      sandbox={allowScripts ? "allow-scripts" : ""}
      style={{ height }}
      className="w-full resize-y self-start rounded-md border border-border"
    />
  );
}
