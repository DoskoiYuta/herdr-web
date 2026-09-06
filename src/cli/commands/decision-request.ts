import * as v from "valibot";
import { DecisionSpecSchema } from "../../contract/decision";
import { flagString, parseArgs } from "../args";
import {
  type CommandDeps,
  type CommandResult,
  clientErrorResult,
  EXIT_OK,
  EXIT_USAGE,
  usageError,
} from "./types";

function formatIssue(issue: v.BaseIssue<unknown>): string {
  const path = (issue.path ?? []).map((p) => String(p.key)).join(".") || "(root)";
  return `${path}: ${issue.message}`;
}

/** `hw decision request [--file d.json] [--pane <id>]` (stdin if `--file` is omitted). */
export async function decisionRequestCommand(
  argv: string[],
  deps: CommandDeps,
): Promise<CommandResult> {
  const parsed = parseArgs(argv, { string: ["file", "pane"] });
  if (!parsed.ok) return usageError(parsed.error);
  const { flags, positionals } = parsed.value;
  if (positionals.length > 0) {
    return usageError(
      `hw decision request takes no positional arguments, got: ${positionals.join(" ")}`,
    );
  }

  const file = flagString(flags, "file");
  if (!file && deps.stdinIsTTY?.()) {
    return {
      exitCode: EXIT_USAGE,
      stdout: "",
      stderr: "usage: hw decision request --file d.json  (or pipe the spec JSON on stdin)\n",
    };
  }
  const raw = file ? await Bun.file(file).text() : await deps.readStdin();

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return {
      exitCode: EXIT_USAGE,
      stdout: "",
      stderr: `invalid JSON: ${err instanceof Error ? err.message : String(err)}\n`,
    };
  }

  const result = v.safeParse(DecisionSpecSchema, json);
  if (!result.success) {
    const lines = result.issues.map(formatIssue);
    return { exitCode: EXIT_USAGE, stdout: "", stderr: `${lines.join("\n")}\n` };
  }

  const paneId = flagString(flags, "pane") ?? deps.env.HERDR_PANE_ID ?? null;
  const claudeSessionId = deps.env.CLAUDE_CODE_SESSION_ID ?? null;

  const created = await deps.client.createDecision({
    spec: result.output,
    paneId,
    claudeSessionId,
  });
  if (!created.ok) return clientErrorResult(created.error);

  const stdout = `${JSON.stringify(created.value)}\n`;
  // F13-3: 呼び出し元 pane が特定できないと回答は自動で届かない — stdout の
  // JSON は agent が読むのでそのまま出し、警告は stderr に分けて人間に伝える。
  if (!paneId || !created.value.paneResolved) {
    return {
      exitCode: EXIT_OK,
      stdout,
      stderr:
        "呼び出し元 pane が特定できないため回答は自動で届きません。URL を人間に伝えて " +
        `\`hw decision show ${created.value.id}\` で確認してください。\n`,
    };
  }
  return { exitCode: EXIT_OK, stdout };
}
