/**
 * Options that take their value as a *separate* argv entry (not `--opt=value`)
 * and so must not have that value mistaken for a revision argument.
 *
 * `-U`/`--unified` are deliberately NOT here: git parses `-U 5` as `-U`
 * (attached-value-only) followed by pathspec/revision `5`, not as `-U`
 * consuming `5`. Only `-U<n>` / `--unified=<n>` (attached forms) carry a
 * value, and those never reach this table since they're a single argv
 * token. Likewise `--color-moved` and `--relative` take only an *optional
 * attached* value (`--color-moved=<mode>`, `--relative=<path>`) — a
 * following bare word is a separate, unconsumed arg — so they are not
 * listed either. Verified against `git diff --help`.
 */
const VALUE_TAKING_OPTIONS = new Set([
  "-O",
  "-l",
  "-S",
  "-G",
  "--src-prefix",
  "--dst-prefix",
  "--line-prefix",
  "--diff-filter",
  "--color-moved-ws",
  "--anchored",
  "--word-diff-regex",
  "--inter-hunk-context",
  "--ignore-matching-lines",
  "-I",
  "--diff-algorithm",
  "--rotate-to",
  "--skip-to",
  "--ws-error-highlight",
  "--find-object",
  "--output",
  "--stat-width",
  "--stat-name-width",
  "--stat-count",
]);

/**
 * Non-option tokens before a literal `--`, excluding values consumed by
 * value-taking options. These are the revision-or-pathspec candidates.
 */
export function bareCandidates(args: string[]): string[] {
  const dashDashIndex = args.indexOf("--");
  const before = dashDashIndex === -1 ? args : args.slice(0, dashDashIndex);
  const out: string[] = [];
  for (let i = 0; i < before.length; i++) {
    const a = before[i]!;
    if (VALUE_TAKING_OPTIONS.has(a)) {
      i++;
      continue;
    }
    if (!a.startsWith("-")) out.push(a);
  }
  return out;
}

/**
 * Insert a HEAD-like revision into a `git diff` argument list when the user
 * gave no revision argument.
 *
 * Rule: among the args before a literal `--`, if there are zero args that do
 * not start with `-` and pass `isRevision` (skipping the value that follows
 * a value-taking option like `-U 5`), and none of the args is `--staged` or
 * `--cached`, insert `headRev` right before the `--` (or at the end if there
 * is no `--`). Otherwise the args are returned unchanged (as a new array).
 *
 * `isRevision(arg)` lets callers plug in a real "does this resolve as a git
 * revision" check; it defaults to treating every non-dash candidate as a
 * revision, preserving prior behavior for pure unit tests.
 */
export function augmentArgs(
  args: string[],
  headRev = "HEAD",
  isRevision: (arg: string) => boolean = () => true,
): string[] {
  const dashDashIndex = args.indexOf("--");
  const beforeDashDash = dashDashIndex === -1 ? args : args.slice(0, dashDashIndex);

  let hasRevision = false;
  // Index (within beforeDashDash) of the first non-option token, whether or
  // not it resolves as a revision. Without a literal `--`, git requires
  // revisions to precede pathspecs (`git diff HEAD src` works, `git diff
  // src HEAD` does not: "fatal: HEAD: no such path in the working tree").
  // So when we do need to insert headRev, it must go right before this
  // token — appending it at the very end would put it after a pathspec.
  let firstCandidateIndex = -1;
  for (let i = 0; i < beforeDashDash.length; i++) {
    const a = beforeDashDash[i]!;
    if (VALUE_TAKING_OPTIONS.has(a)) {
      i++; // skip the value that follows
      continue;
    }
    if (!a.startsWith("-")) {
      if (firstCandidateIndex === -1) firstCandidateIndex = i;
      if (isRevision(a)) {
        hasRevision = true;
        break;
      }
    }
  }
  const hasStagedFlag = args.includes("--staged") || args.includes("--cached");

  if (hasRevision || hasStagedFlag) {
    return [...args];
  }

  const insertAt = firstCandidateIndex === -1 ? beforeDashDash.length : firstCandidateIndex;

  return [...args.slice(0, insertAt), headRev, ...args.slice(insertAt)];
}
