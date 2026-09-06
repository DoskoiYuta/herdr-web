import * as v from "valibot";

// ---------------------------------------------------------------------------
// /api/docker/containers  (read-only view of containers tied to a
// worktree/sub-repo root, inferred from compose/devcontainer labels)
// ---------------------------------------------------------------------------

export const DockerContainersQuerySchema = v.object({
  root: v.pipe(v.string(), v.minLength(1)),
});
export type DockerContainersQuery = v.InferOutput<typeof DockerContainersQuerySchema>;

/** `host`/`container` are strings, not numbers — `docker ps` reports a
 * published port range (e.g. `8000-8010`) as-is, not one port per line. */
export const DockerPortSchema = v.object({
  host: v.string(),
  container: v.string(),
  proto: v.string(),
});
export type DockerPort = v.InferOutput<typeof DockerPortSchema>;

export const DockerContainerSchema = v.object({
  id: v.string(),
  name: v.string(),
  /** `com.docker.compose.service` label; null for a devcontainer group. */
  service: v.nullable(v.string()),
  state: v.string(),
  status: v.string(),
  image: v.string(),
  ports: v.array(DockerPortSchema),
  createdAt: v.string(),
});
export type DockerContainer = v.InferOutput<typeof DockerContainerSchema>;

export const DockerGroupKindSchema = v.picklist(["compose", "devcontainer"]);
export type DockerGroupKind = v.InferOutput<typeof DockerGroupKindSchema>;

export const DockerGroupSchema = v.object({
  kind: DockerGroupKindSchema,
  name: v.string(),
  workingDir: v.string(),
  containers: v.array(DockerContainerSchema),
});
export type DockerGroup = v.InferOutput<typeof DockerGroupSchema>;

export const DockerContainersResponseSchema = v.object({
  groups: v.array(DockerGroupSchema),
});
export type DockerContainersResponse = v.InferOutput<typeof DockerContainersResponseSchema>;

// ---------------------------------------------------------------------------
// WebSocket /ws/docker-logs?root=&id=&tail=  (F11-9)
// ---------------------------------------------------------------------------

export const DockerLogsLineMessageSchema = v.object({
  type: v.literal("line"),
  stream: v.picklist(["stdout", "stderr"]),
  text: v.string(),
});
export type DockerLogsLineMessage = v.InferOutput<typeof DockerLogsLineMessageSchema>;

export const DockerLogsExitMessageSchema = v.object({
  type: v.literal("exit"),
  code: v.number(),
});
export type DockerLogsExitMessage = v.InferOutput<typeof DockerLogsExitMessageSchema>;

export const DockerLogsErrorCodeSchema = v.picklist([
  "forbidden",
  "not-found",
  "docker-unavailable",
  "failed",
]);
export type DockerLogsErrorCode = v.InferOutput<typeof DockerLogsErrorCodeSchema>;

export const DockerLogsErrorMessageSchema = v.object({
  type: v.literal("error"),
  code: DockerLogsErrorCodeSchema,
  message: v.string(),
});
export type DockerLogsErrorMessage = v.InferOutput<typeof DockerLogsErrorMessageSchema>;

export const DockerLogsServerMessageSchema = v.union([
  DockerLogsLineMessageSchema,
  DockerLogsExitMessageSchema,
  DockerLogsErrorMessageSchema,
]);
export type DockerLogsServerMessage = v.InferOutput<typeof DockerLogsServerMessageSchema>;
