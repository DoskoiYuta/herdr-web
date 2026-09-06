import { run, type ExecRunResult } from "../exec/run";

/** Thrown when the `docker` binary itself is missing (`ENOENT`). Routes map
 * this to HTTP 501 — distinct from a non-zero exit (daemon unreachable, 503). */
export class DockerNotFoundError extends Error {
  constructor() {
    super("docker command not found");
    this.name = "DockerNotFoundError";
  }
}

export type DockerRunResult = ExecRunResult;

export interface CreateDockerRunnerOptions {
  /** Overridable for tests; production default is 5s. */
  timeoutMs?: number;
  /** Overridable for tests (a fake `docker` script). */
  bin?: string;
}

export interface DockerRunner {
  /** Runs `docker ps -a --no-trunc --format <tab-separated template>`.
   * Never throws on a non-zero exit (e.g. daemon unreachable) — that comes
   * back on the result. Rejects with `DockerNotFoundError` when `docker`
   * itself is missing. */
  ps(): Promise<DockerRunResult>;
}

/** Tab-separated rather than `{{json .}}` — `Labels` in the JSON format is
 * a single `k=v,k=v` string, and a label value containing a comma (e.g.
 * `com.docker.compose.project.config_files` listing multiple files) can't
 * be split back apart unambiguously. Requesting only the labels actually
 * used, by name, sidesteps that. */
const PS_FORMAT = [
  "{{.ID}}",
  "{{.Names}}",
  "{{.State}}",
  "{{.Status}}",
  "{{.Image}}",
  "{{.Ports}}",
  "{{.CreatedAt}}",
  '{{.Label "com.docker.compose.project"}}',
  '{{.Label "com.docker.compose.service"}}',
  '{{.Label "com.docker.compose.project.working_dir"}}',
  '{{.Label "devcontainer.local_folder"}}',
].join("\t");

export function createDockerRunner(options: CreateDockerRunnerOptions = {}): DockerRunner {
  const { timeoutMs = 5000, bin = "docker" } = options;

  return {
    ps: () =>
      run(
        bin,
        ["ps", "-a", "--no-trunc", "--format", PS_FORMAT],
        timeoutMs,
        () => new DockerNotFoundError(),
      ),
  };
}
