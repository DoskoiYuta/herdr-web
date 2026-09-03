import { sha1_12 } from "./hash";

const INDEX_RE = /^index ([0-9a-f]{40}|[0-9a-f]{64})\.\.([0-9a-f]{40}|[0-9a-f]{64})(?: .*)?$/;

export interface PatchPiece {
  name: string;
  prevName: string | null;
  text: string;
  hash: string;
  oldHash: string | null;
  newHash: string | null;
}

/**
 * Split a `git diff` patch into per-file pieces on lines starting with
 * `diff --git `. Each piece keeps its verbatim text plus name/prevName and
 * old/new blob hashes parsed out of its header.
 */
export function splitPatchByFile(patch: string): PatchPiece[] {
  if (!patch) return [];

  const starts: number[] = [];
  const marker = /^diff --git /gm;
  let m: RegExpExecArray | null;
  while ((m = marker.exec(patch)) !== null) {
    starts.push(m.index);
  }
  if (starts.length === 0) return [];

  return starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1]! : patch.length;
    const text = patch.slice(start, end);
    return parsePiece(text);
  });
}

function parsePiece(text: string): PatchPiece {
  const headerLines: string[] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("@@ ") || line.startsWith("Binary files ")) break;
    headerLines.push(line);
  }

  let renameFrom: string | null = null;
  let renameTo: string | null = null;
  let minusName: string | null = null;
  let plusName: string | null = null;
  let oldHash: string | null = null;
  let newHash: string | null = null;

  for (const line of headerLines) {
    let mm: RegExpExecArray | null;
    if ((mm = /^(?:rename|copy) from (.+)$/.exec(line))) {
      renameFrom = mm[1]!;
    } else if ((mm = /^(?:rename|copy) to (.+)$/.exec(line))) {
      renameTo = mm[1]!;
    } else if ((mm = /^--- a\/(.+)$/.exec(line))) {
      minusName = mm[1]!;
    } else if ((mm = /^\+\+\+ b\/(.+)$/.exec(line))) {
      plusName = mm[1]!;
    } else if ((mm = INDEX_RE.exec(line))) {
      oldHash = normalizeHash(mm[1]!);
      newHash = normalizeHash(mm[2]!);
    }
  }

  let name: string;
  let prevName: string | null = null;
  if (renameTo != null) {
    name = renameTo;
    prevName = renameFrom;
  } else if (plusName != null) {
    name = plusName;
  } else if (minusName != null) {
    name = minusName;
  } else {
    name = fallbackNameFromHeader(headerLines[0] ?? "");
  }

  return { name, prevName, text, hash: sha1_12(text), oldHash, newHash };
}

function normalizeHash(hash: string): string | null {
  return /^0+$/.test(hash) ? null : hash;
}

function fallbackNameFromHeader(headerLine: string): string {
  const idx = headerLine.lastIndexOf(" b/");
  if (idx === -1) return headerLine.replace(/^diff --git /, "");
  return headerLine.slice(idx + 3);
}
