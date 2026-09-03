import type { CommitDetail, CommitFile, FileStatus } from "../../contract/git";
import { runGit } from "./run";

const RECORD_SEP = "\x1e";
const FIELD_SEP_PLACEHOLDER = "%x00";
const RECORD_SEP_PLACEHOLDER = "%x1e";
const SHOW_FORMAT =
  ["%H", "%P", "%an", "%ae", "%at", "%cn", "%ce", "%ct", "%B"].join(FIELD_SEP_PLACEHOLDER) +
  RECORD_SEP_PLACEHOLDER;

/**
 * Splits `--name-status -z` output into `{status, path}` / `{status, oldPath, path}`
 * entries. `-z` NUL-separates every token; a rename/copy status comes as
 * `R100\0old\0new\0` (three tokens), everything else as `S\0path\0`.
 */
type NameStatusEntry = Omit<CommitFile, "additions" | "deletions">;

function parseNameStatus(raw: string): NameStatusEntry[] {
  const tokens = raw.split("\x00").filter((t) => t.length > 0);
  const files: NameStatusEntry[] = [];
  let i = 0;
  while (i < tokens.length) {
    const statusToken = tokens[i]!;
    const status = statusToken[0] as FileStatus;
    if (status === "R" || status === "C") {
      const oldPath = tokens[i + 1]!;
      const path = tokens[i + 2]!;
      files.push({ status, path, oldPath });
      i += 3;
    } else {
      const path = tokens[i + 1]!;
      files.push({ status, path });
      i += 2;
    }
  }
  return files;
}

interface NumstatEntry {
  additions: number | null;
  deletions: number | null;
}

/**
 * Parses `git show --numstat -z` output into a map keyed by the (new) path.
 *
 * Each record is normally `add\tdel\tpath\0`. For a rename/copy, git instead
 * emits `add\tdel\t\0old\0new\0` — the path field is empty, followed by the
 * old and new paths as their own NUL-terminated tokens. Binary files report
 * `-\t-\t` for add/del, which we surface as `null`.
 */
function parseNumstat(raw: string): Map<string, NumstatEntry> {
  const tokens = raw.split("\x00");
  // A trailing NUL (there always is one) produces one empty token at the end.
  if (tokens[tokens.length - 1] === "") tokens.pop();

  const result = new Map<string, NumstatEntry>();
  let i = 0;
  while (i < tokens.length) {
    const record = tokens[i]!;
    const tabIndex1 = record.indexOf("\t");
    const tabIndex2 = record.indexOf("\t", tabIndex1 + 1);
    const addStr = record.slice(0, tabIndex1);
    const delStr = record.slice(tabIndex1 + 1, tabIndex2);
    const pathPart = record.slice(tabIndex2 + 1);
    const additions = addStr === "-" ? null : Number(addStr);
    const deletions = delStr === "-" ? null : Number(delStr);

    if (pathPart === "") {
      // Rename/copy: old path and new path follow as separate tokens.
      const newPath = tokens[i + 2]!;
      result.set(newPath, { additions, deletions });
      i += 3;
    } else {
      result.set(pathPart, { additions, deletions });
      i += 1;
    }
  }
  return result;
}

/**
 * Full commit detail: message body plus the changed-file list (with
 * rename/copy source paths and per-file additions/deletions).
 */
export async function getCommitDetail(repoDir: string, hash: string): Promise<CommitDetail> {
  const [{ stdout }, { stdout: numstatRaw }] = await Promise.all([
    runGit(["show", `--format=${SHOW_FORMAT}`, "--name-status", "-M", "-z", "--no-color", hash], {
      cwd: repoDir,
    }),
    runGit(["show", "--format=", "--numstat", "-M", "-z", "--no-color", hash], { cwd: repoDir }),
  ]);

  // The header (ending at our RECORD_SEP) is followed directly by the -z
  // name-status block; find the record separator to split them.
  const sepIndex = stdout.indexOf(RECORD_SEP);
  const header = stdout.slice(0, sepIndex);
  // `-z` makes git terminate the --format output with an extra NUL (on top
  // of our own %x1e), followed by a blank line before the name-status block.
  // biome-ignore lint: intentional NUL match, `-z` output is NUL-delimited
  // eslint-disable-next-line no-control-regex
  const rest = stdout.slice(sepIndex + RECORD_SEP.length).replace(/^[\x00\n]+/, "");

  const fields = header.split("\x00");
  const [
    commitHash,
    parents,
    author,
    authorEmail,
    authorDate,
    committer,
    ,
    commitDate,
    ...bodyParts
  ] = fields;
  const body = bodyParts.join("\x00").replace(/^\n/, "").replace(/\n$/, "");
  const lines = body.split("\n");
  const subject = lines[0] ?? "";
  const restBody = lines.slice(1).join("\n").replace(/^\n/, "");

  const numstat = parseNumstat(numstatRaw.replace(/^\n+/, ""));
  const files = parseNameStatus(rest).map((f) => {
    const entry = numstat.get(f.path);
    return { ...f, additions: entry?.additions ?? null, deletions: entry?.deletions ?? null };
  });

  return {
    hash: commitHash ?? "",
    parents: parents && parents.length > 0 ? parents.split(" ") : [],
    author: author ?? "",
    authorEmail: authorEmail ?? "",
    authorDate: Number(authorDate),
    committer: committer ?? "",
    commitDate: Number(commitDate),
    subject,
    body: restBody,
    files,
  };
}
