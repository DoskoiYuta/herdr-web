import * as v from "valibot";

// ---------------------------------------------------------------------------
// /api/proc/list  (read-only view of processes whose cwd is under a
// worktree/sub-repo root. Flat — the client builds the ppid tree.)
// ---------------------------------------------------------------------------

export const ProcListQuerySchema = v.object({
  root: v.pipe(v.string(), v.minLength(1)),
});
export type ProcListQuery = v.InferOutput<typeof ProcListQuerySchema>;

export const ProcListenSchema = v.object({
  port: v.number(),
  addr: v.string(),
});
export type ProcListen = v.InferOutput<typeof ProcListenSchema>;

export const ProcessInfoSchema = v.object({
  pid: v.number(),
  ppid: v.number(),
  command: v.string(),
  argv0: v.string(),
  cpu: v.number(),
  rss: v.number(),
  elapsedSec: v.number(),
  cwd: v.string(),
  listen: v.array(ProcListenSchema),
});
export type ProcessInfo = v.InferOutput<typeof ProcessInfoSchema>;

export const ProcListResponseSchema = v.object({
  processes: v.array(ProcessInfoSchema),
});
export type ProcListResponse = v.InferOutput<typeof ProcListResponseSchema>;
