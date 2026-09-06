// `code` Block: syntax-highlighted, read-only. Uses @pierre/diffs react's
// `File` component directly (no line selection / annotations needed here,
// unlike CodeFileView.tsx's CodeView usage for the Files tab).
import { File } from "@pierre/diffs/react";
import { useIsDark } from "@/lib/useIsDark";
import { isTooLarge, TooLargeBlock } from "./TooLargeBlock";

export function CodeBlock({ language, text }: { language: string; text: string }) {
  const isDark = useIsDark();
  if (isTooLarge(text)) return <TooLargeBlock text={text} />;
  return (
    <File
      file={{ name: `block.${language}`, contents: text, lang: language }}
      options={{
        theme: { dark: "pierre-dark", light: "pierre-light" },
        themeType: isDark ? "dark" : "light",
      }}
    />
  );
}
