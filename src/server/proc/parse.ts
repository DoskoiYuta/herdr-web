import { basename } from "node:path";
import type { ProcessInfo, ProcListen } from "../../contract/proc";
import { pathUnderAnyRoot } from "../fs/belongsToRoot";

export interface ParsedPsEntry {
  pid: number;
  ppid: number;
  cpu: number;
  rss: number;
  elapsedSec: number;
  command: string;
  argv0: string;
}

/** `[[dd-]hh:]mm:ss` (the `ps -o etime=` format on both macOS and Linux) to seconds. */
export function parseEtime(raw: string): number {
  const trimmed = raw.trim();
  let days = 0;
  let rest = trimmed;
  const dayMatch = /^(\d+)-(.+)$/.exec(rest);
  if (dayMatch?.[1] && dayMatch[2]) {
    days = Number(dayMatch[1]);
    rest = dayMatch[2];
  }
  const parts = rest.split(":").map(Number);
  let hours = 0;
  let minutes = 0;
  let seconds = 0;
  if (parts.length === 3) {
    [hours, minutes, seconds] = parts as [number, number, number];
  } else if (parts.length === 2) {
    [minutes, seconds] = parts as [number, number];
  } else {
    seconds = parts[0] ?? 0;
  }
  return ((days * 24 + hours) * 60 + minutes) * 60 + seconds;
}

/** One line of `ps -axo pid=,ppid=,pcpu=,rss=,etime=,command=`. `command`
 * is the last field and may itself contain spaces, so only the first 5
 * whitespace-separated tokens are fixed columns. */
export function parsePsLine(line: string): ParsedPsEntry | null {
  const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
  if (!m) return null;
  const [, pidStr, ppidStr, cpuStr, rssStr, etimeRaw, command] = m;
  if (!pidStr || !ppidStr || !cpuStr || !rssStr || !etimeRaw || command === undefined) return null;
  const firstToken = command.split(/\s+/)[0] ?? "";
  return {
    pid: Number(pidStr),
    ppid: Number(ppidStr),
    cpu: Number(cpuStr),
    rss: Number(rssStr),
    elapsedSec: parseEtime(etimeRaw),
    command,
    argv0: basename(firstToken.replace(/^-/, "")),
  };
}

export function parsePsOutput(stdout: string): ParsedPsEntry[] {
  return stdout
    .split("\n")
    .map(parsePsLine)
    .filter((e): e is ParsedPsEntry => e !== null);
}

/** `lsof -Fpn` output: a `p<pid>` line followed by one or more `n<name>`
 * lines belonging to that pid. Shared shape for both the `cwd` and
 * `LISTEN` lsof invocations. */
export function parseLsofPidNames(output: string): Map<number, string[]> {
  const map = new Map<number, string[]>();
  let currentPid: number | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("p")) {
      currentPid = Number(line.slice(1));
      if (!map.has(currentPid)) map.set(currentPid, []);
    } else if (line.startsWith("n") && currentPid !== null) {
      map.get(currentPid)?.push(line.slice(1));
    }
  }
  return map;
}

function stripBrackets(addr: string): string {
  return addr.startsWith("[") && addr.endsWith("]") ? addr.slice(1, -1) : addr;
}

/** `*:8080` / `127.0.0.1:8090` / `[::1]:8090` -> `{ port, addr }`. */
export function parseListenAddr(name: string): ProcListen | null {
  const m = /^(.*):(\d+)$/.exec(name);
  if (!m?.[1] || !m[2]) return null;
  return { addr: stripBrackets(m[1]), port: Number(m[2]) };
}

/** A dual-stack listener (IPv4 + IPv6 on the same port) makes `lsof` print
 * the same `addr:port` twice — collapse to one entry. */
function dedupeListen(entries: ProcListen[]): ProcListen[] {
  const seen = new Set<string>();
  const out: ProcListen[] = [];
  for (const entry of entries) {
    const key = `${entry.addr}:${entry.port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/** Joins `ps`/`lsof -d cwd`/`lsof -iTCP -sTCP:LISTEN` by pid and filters to
 * processes whose cwd is under one of `roots`. A pid absent from the cwd
 * lsof output (e.g. a zombie, or a race between the two lsof runs) is
 * dropped rather than guessed at. */
export function buildProcessList(
  psStdout: string,
  lsofCwdStdout: string,
  lsofListenStdout: string,
  roots: string[],
): ProcessInfo[] {
  const cwdByPid = parseLsofPidNames(lsofCwdStdout);
  const listenByPid = parseLsofPidNames(lsofListenStdout);

  const out: ProcessInfo[] = [];
  for (const entry of parsePsOutput(psStdout)) {
    const cwd = cwdByPid.get(entry.pid)?.[0];
    if (!cwd || !pathUnderAnyRoot(cwd, roots)) continue;
    const listen = dedupeListen(
      (listenByPid.get(entry.pid) ?? [])
        .map(parseListenAddr)
        .filter((l): l is ProcListen => l !== null),
    );
    out.push({
      pid: entry.pid,
      ppid: entry.ppid,
      command: entry.command,
      argv0: entry.argv0,
      cpu: entry.cpu,
      rss: entry.rss,
      elapsedSec: entry.elapsedSec,
      cwd,
      listen,
    });
  }
  return out;
}
