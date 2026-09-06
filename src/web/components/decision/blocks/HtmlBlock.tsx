// `html` Block: rendered in a sandboxed iframe via `srcdoc`.
// `allow-same-origin` is deliberately never granted — combined with
// `allow-scripts` it would let embedded script reach back into this origin
// (read cookies/localStorage, call same-origin fetches), defeating the
// sandbox. Height is left to the human (resize-y) rather than measured via
// postMessage, since the request author controls neither this page's origin
// nor the iframe's, so a self-reported height can't be trusted either.
export function HtmlBlock({ html, allowScripts }: { html: string; allowScripts: boolean }) {
  return (
    <iframe
      title="html block"
      srcDoc={html}
      sandbox={allowScripts ? "allow-scripts" : ""}
      className="min-h-[12rem] w-full resize-y rounded-md border border-border bg-white"
    />
  );
}
