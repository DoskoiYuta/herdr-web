import { basename } from "node:path";
import type {
  DockerContainer,
  DockerGroup,
  DockerGroupKind,
  DockerPort,
} from "../../contract/docker";
import { pathUnderAnyRoot } from "../fs/belongsToRoot";

/** One line of `docker ps -a --no-trunc --format` (see docker/runner.ts's
 * tab-separated template) — the four labels are already picked out by
 * name, no generic `Labels` blob to split. */
export interface ParsedContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  createdAt: string;
  composeProject: string | null;
  composeService: string | null;
  composeWorkingDir: string | null;
  devcontainerLocalFolder: string | null;
  ports: DockerPort[];
}

/** `docker ps`'s `Ports` field, e.g. `0.0.0.0:8080->80/tcp, :::8080->80/tcp`,
 * or a range: `0.0.0.0:8000-8010->8000-8010/tcp`. IPv4/IPv6 entries for the
 * same host:container:proto collapse to one. */
export function parsePorts(raw: string): DockerPort[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: DockerPort[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const m = /^(.+)->(\d+(?:-\d+)?)\/(\w+)$/.exec(trimmed);
    if (!m) continue;
    const [, hostSide, container, proto] = m;
    const hostMatch = /:(\d+(?:-\d+)?)$/.exec(hostSide ?? "");
    if (!hostMatch?.[1] || !container || !proto) continue;
    const host = hostMatch[1];
    const key = `${host}:${container}/${proto}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ host, container, proto });
  }
  return out;
}

function label(raw: string | undefined): string | null {
  return raw ? raw : null;
}

/** One line of the tab-separated `docker ps` output. Returns null for a
 * blank line (trailing newline). */
export function parseDockerPsLine(line: string): ParsedContainer | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const [
    id,
    name,
    state,
    status,
    image,
    ports,
    createdAt,
    composeProject,
    composeService,
    composeWorkingDir,
    devcontainerLocalFolder,
  ] = trimmed.split("\t");
  return {
    id: id ?? "",
    name: name ?? "",
    image: image ?? "",
    state: state ?? "",
    status: status ?? "",
    createdAt: createdAt ?? "",
    composeProject: label(composeProject),
    composeService: label(composeService),
    composeWorkingDir: label(composeWorkingDir),
    devcontainerLocalFolder: label(devcontainerLocalFolder),
    ports: parsePorts(ports ?? ""),
  };
}

export function parseDockerPsOutput(stdout: string): ParsedContainer[] {
  return stdout
    .split("\n")
    .map(parseDockerPsLine)
    .filter((c): c is ParsedContainer => c !== null);
}

interface RootMatch {
  kind: DockerGroupKind;
  groupName: string;
  workingDir: string;
  service: string | null;
}

/** A container without either label is out of scope entirely — no
 * bind-mount-only `docker run` container can be tied to a root reliably. */
function classifyByRoot(container: ParsedContainer, roots: string[]): RootMatch | null {
  const { composeWorkingDir, devcontainerLocalFolder } = container;
  if (composeWorkingDir !== null && pathUnderAnyRoot(composeWorkingDir, roots)) {
    return {
      kind: "compose",
      groupName: container.composeProject ?? basename(composeWorkingDir),
      workingDir: composeWorkingDir,
      service: container.composeService,
    };
  }
  if (devcontainerLocalFolder !== null && pathUnderAnyRoot(devcontainerLocalFolder, roots)) {
    return {
      kind: "devcontainer",
      groupName: basename(devcontainerLocalFolder),
      workingDir: devcontainerLocalFolder,
      service: null,
    };
  }
  return null;
}

function containerSortKey(a: DockerContainer, b: DockerContainer): number {
  const aRunning = a.state === "running" ? 0 : 1;
  const bRunning = b.state === "running" ? 0 : 1;
  if (aRunning !== bRunning) return aRunning - bRunning;
  if (a.state !== b.state) return a.state.localeCompare(b.state);
  return a.name.localeCompare(b.name);
}

/** Filters to containers tied to one of `roots`, groups by compose project /
 * devcontainer folder, and sorts each group's containers running-first,
 * then state, then name. */
export function groupContainers(containers: ParsedContainer[], roots: string[]): DockerGroup[] {
  const groups = new Map<string, DockerGroup>();
  for (const c of containers) {
    const match = classifyByRoot(c, roots);
    if (!match) continue;
    const key = `${match.kind}:${match.groupName}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        kind: match.kind,
        name: match.groupName,
        workingDir: match.workingDir,
        containers: [],
      };
      groups.set(key, group);
    }
    group.containers.push({
      id: c.id,
      name: c.name,
      service: match.service,
      state: c.state,
      status: c.status,
      image: c.image,
      ports: c.ports,
      createdAt: c.createdAt,
    });
  }
  const result = [...groups.values()];
  for (const group of result) group.containers.sort(containerSortKey);
  result.sort((a, b) => a.name.localeCompare(b.name));
  return result;
}
