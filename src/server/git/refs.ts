import type { Head, Ref, RefType, Stash } from "../../contract/git";
import { runGit } from "./run";

const FOR_EACH_REF_FORMAT = [
  "%(refname)",
  "%(objectname)",
  "%(*objectname)",
  "%(HEAD)",
  "%(upstream:short)",
  "%(upstream:track)",
].join("%00");

const HEADS_PREFIX = "refs/heads/";
const REMOTES_PREFIX = "refs/remotes/";
const TAGS_PREFIX = "refs/tags/";

function refTypeAndName(refname: string): { type: RefType; name: string } | null {
  if (refname.startsWith(HEADS_PREFIX))
    return { type: "head", name: refname.slice(HEADS_PREFIX.length) };
  if (refname.startsWith(REMOTES_PREFIX))
    return { type: "remote", name: refname.slice(REMOTES_PREFIX.length) };
  if (refname.startsWith(TAGS_PREFIX))
    return { type: "tag", name: refname.slice(TAGS_PREFIX.length) };
  return null;
}

const TRACK_RE = /(?:ahead (\d+))?,? ?(?:behind (\d+))?/;

function parseTrack(track: string): { ahead?: number; behind?: number } {
  if (!track || track === "[gone]") return {};
  const inner = track.replace(/^\[|\]$/g, "");
  const match = TRACK_RE.exec(inner);
  const ahead = match?.[1] !== undefined ? Number(match[1]) : undefined;
  const behind = match?.[2] !== undefined ? Number(match[2]) : undefined;
  const result: { ahead?: number; behind?: number } = {};
  if (ahead !== undefined) result.ahead = ahead;
  if (behind !== undefined) result.behind = behind;
  return result;
}

export interface ListRefsResult {
  refs: Ref[];
  head: Head;
  stashes: Stash[];
}

/**
 * Lists branches/remotes/tags (peeling annotated tags), resolves HEAD
 * (including the detached case) and the stash list.
 */
export async function listRefs(repoDir: string): Promise<ListRefsResult> {
  const [forEachRef, symbolicRef, revParseHead, stashList] = await Promise.all([
    runGit(["for-each-ref", `--format=${FOR_EACH_REF_FORMAT}`], { cwd: repoDir }),
    runGit(["symbolic-ref", "-q", "--short", "HEAD"], { cwd: repoDir, okCodes: [0, 1] }),
    runGit(["rev-parse", "HEAD"], { cwd: repoDir, okCodes: [0, 128] }),
    runGit(["stash", "list", "--format=%H%x00%gd%x00%s"], { cwd: repoDir }),
  ]);

  const refs: Ref[] = [];
  for (const line of forEachRef.stdout.split("\n")) {
    if (line.length === 0) continue;
    const [refname, objectname, peeled, headMark, upstream, track] = line.split("\x00");
    if (refname === "refs/stash" || !refname) continue;
    const typed = refTypeAndName(refname);
    if (!typed) continue;
    const hash = peeled && peeled.length > 0 ? peeled : (objectname ?? "");
    const ref: Ref = {
      name: typed.name,
      fullName: refname,
      type: typed.type,
      hash,
      isHead: headMark === "*",
      ...(upstream ? { upstream } : {}),
      ...parseTrack(track ?? ""),
    };
    refs.push(ref);
  }

  const detached = symbolicRef.code !== 0;
  const branch = detached ? undefined : symbolicRef.stdout.trim();
  const headHash = revParseHead.code === 0 ? revParseHead.stdout.trim() : "";
  const head: Head = { hash: headHash, detached, ...(branch ? { branch } : {}) };

  const stashes: Stash[] = stashList.stdout
    .split("\n")
    .filter((l) => l.length > 0)
    .map((line) => {
      const [hash, selector, subject] = line.split("\x00");
      return { hash: hash ?? "", selector: selector ?? "", subject: subject ?? "" };
    });

  return { refs, head, stashes };
}
