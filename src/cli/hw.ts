#!/usr/bin/env bun
import { createHwClient } from "./client";
import { runCli } from "./cli";
import { resolveHwUrl } from "./url";

const baseUrl = await resolveHwUrl(process.env, (path) => Bun.file(path).text());
const client = createHwClient(baseUrl);

const result = await runCli(process.argv.slice(2), {
  client,
  env: process.env,
  cwd: process.cwd(),
  readStdin: () => Bun.stdin.text(),
});

process.stdout.write(result.stdout);
process.exit(result.exitCode);
