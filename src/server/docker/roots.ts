import { realpath } from "node:fs/promises";

/** A compose `working_dir` label is a logical path (`$PWD` at `docker
 * compose up` time), so resolve the root's realpath too — a symlinked root
 * would otherwise never match. Falls back to the raw root alone when
 * realpath fails (caller is expected to have already validated the root). */
export async function resolveRoots(root: string): Promise<string[]> {
  try {
    const real = await realpath(root);
    return real === root ? [root] : [root, real];
  } catch {
    return [root];
  }
}
