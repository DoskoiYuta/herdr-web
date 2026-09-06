// `svg` Block: source markup is untrusted, so it never touches
// innerHTML — going through an <img src="data:image/svg+xml,..."> means the
// browser rasterizes it without ever running <script>/event-handler content
// inside the SVG (contrast with the `mermaid` Block, whose SVG is
// mermaid's own strict-mode output and safe to insert directly).
export function SvgBlock({ markup }: { markup: string }) {
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  return <img src={src} alt="" className="max-w-full" />;
}
