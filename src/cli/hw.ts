#!/usr/bin/env bun
import { createHwClient } from "./client";
import { runCli } from "./cli";

const baseUrl = process.env.HW_URL ?? "http://127.0.0.1:8080";
const client = createHwClient(baseUrl);

const result = await runCli(process.argv.slice(2), {
  client,
  env: process.env,
  cwd: process.cwd(),
  readStdin: () => Bun.stdin.text(),
});

process.stdout.write(result.stdout);
process.exit(result.exitCode);
