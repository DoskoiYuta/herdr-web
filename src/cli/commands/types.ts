import type { ClientError } from "../client";
import type { HwClient } from "../client";

export type CommandResult = { exitCode: number; stdout: string };

export type CommandDeps = {
  client: HwClient;
  env: Record<string, string | undefined>;
  cwd: string;
  /** Read stdin fully, used by `hw review reply <id> -`. */
  readStdin: () => Promise<string>;
};

export const EXIT_OK = 0;
export const EXIT_USAGE = 1;
export const EXIT_UNREACHABLE = 2;
export const EXIT_DOMAIN = 3;

export function usageError(message: string): CommandResult {
  return { exitCode: EXIT_USAGE, stdout: `${message}\n` };
}

/** Maps a failed HwClient call to a CLI exit code, per plan §7 F6-5 / spec exit codes. */
export function clientErrorResult(error: ClientError): CommandResult {
  if (error.kind === "network") {
    return { exitCode: EXIT_UNREACHABLE, stdout: `server unreachable: ${error.message}\n` };
  }
  return { exitCode: EXIT_DOMAIN, stdout: `${error.message}\n` };
}
