/**
 * dist/web の全ファイルを `import ... with { type: "file" }` で束ねた TS モジュールを生成する。
 * `bun build --compile` はこの import を埋め込みファイルとして同梱するので、単一バイナリから静的配信できる。
 */
import { readdir, stat } from "node:fs/promises";
import { join, relative } from "node:path";

const root = join(import.meta.dir, "..");
const webDir = join(root, "dist", "web");
const outFile = join(root, "src", "server", "web-assets.generated.ts");

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

const files = (await walk(webDir)).sort();
const lines: string[] = [
  "// 自動生成: bun scripts/embed-web.ts（bun run build:web の後）。手で編集しない。",
  "",
];
files.forEach((f, i) => {
  const rel = relative(root, f).replaceAll("\\", "/");
  lines.push(`import a${i} from "../../${rel}" with { type: "file" };`);
});
lines.push("", "export const webAssets: Record<string, string> = {");
files.forEach((f, i) => {
  const urlPath = "/" + relative(webDir, f).replaceAll("\\", "/");
  lines.push(`  ${JSON.stringify(urlPath)}: a${i},`);
});
lines.push("};", "");
await Bun.write(outFile, lines.join("\n"));
console.log(`embedded ${files.length} files → ${relative(root, outFile)}`);
