import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import type { WorktreeFileReader } from "../ports";

/** worktree 内のファイルを行配列で読む。root の外に出るパスは null。 */
export function createWorktreeFileReader(): WorktreeFileReader {
  return {
    async readLines(root, path) {
      if (isAbsolute(path) || path.includes("\0")) return null;
      const abs = resolve(root, path);
      let realRoot: string;
      let realFile: string;
      try {
        realRoot = await realpath(root);
        realFile = await realpath(abs);
      } catch {
        return null;
      }
      if (realFile !== realRoot && !realFile.startsWith(realRoot + sep)) return null;
      try {
        const text = await readFile(realFile, "utf8");
        return splitLines(text);
      } catch {
        return null;
      }
    },
  };
}

export function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}
