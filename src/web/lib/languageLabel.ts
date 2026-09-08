// Simple extension -> display-language mapping for the Files header
// ("path · size · TypeScript"). Not a syntax-highlighting language id list —
// just enough to label common file kinds; anything else is omitted.
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  json: "JSON",
  md: "Markdown",
  markdown: "Markdown",
  css: "CSS",
  html: "HTML",
  yml: "YAML",
  yaml: "YAML",
  sh: "Shell",
  bash: "Shell",
  py: "Python",
  rs: "Rust",
  go: "Go",
  sql: "SQL",
  toml: "TOML",
};

export function languageLabel(path: string): string | null {
  const ext = path.split("/").pop()?.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return LANGUAGE_BY_EXTENSION[ext] ?? null;
}
