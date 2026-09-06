import { describe, expect, test } from "bun:test";
import { groupContainers, parseDockerPsOutput, parsePorts } from "./parse";

const ROOT = "/home/u/herdr-web";

function psLine(fields: {
  id: string;
  names: string;
  state: string;
  status: string;
  image: string;
  ports?: string;
  createdAt?: string;
  composeProject?: string;
  composeService?: string;
  composeWorkingDir?: string;
  devcontainerLocalFolder?: string;
}): string {
  return [
    fields.id,
    fields.names,
    fields.state,
    fields.status,
    fields.image,
    fields.ports ?? "",
    fields.createdAt ?? "c",
    fields.composeProject ?? "",
    fields.composeService ?? "",
    fields.composeWorkingDir ?? "",
    fields.devcontainerLocalFolder ?? "",
  ].join("\t");
}

describe("parsePorts", () => {
  test("dedupes the IPv4/IPv6 pair for the same host:container:proto", () => {
    expect(parsePorts("0.0.0.0:8080->80/tcp, :::8080->80/tcp")).toEqual([
      { host: "8080", container: "80", proto: "tcp" },
    ]);
  });

  test("keeps distinct host ports as separate entries", () => {
    expect(parsePorts("0.0.0.0:8080->80/tcp, 0.0.0.0:8443->443/tcp")).toEqual([
      { host: "8080", container: "80", proto: "tcp" },
      { host: "8443", container: "443", proto: "tcp" },
    ]);
  });

  test("keeps a published port range intact rather than dropping the line", () => {
    expect(parsePorts("0.0.0.0:8000-8010->8000-8010/tcp")).toEqual([
      { host: "8000-8010", container: "8000-8010", proto: "tcp" },
    ]);
  });

  test("empty string yields no ports (container publishes none)", () => {
    expect(parsePorts("")).toEqual([]);
  });
});

describe("parseDockerPsOutput", () => {
  test("parses one tab-separated record into a container with its labels and ports", () => {
    const stdout =
      psLine({
        id: "abc123",
        names: "herdr-web-app-1",
        state: "running",
        status: "Up 3 hours",
        image: "node:20",
        ports: "0.0.0.0:8080->80/tcp",
        composeProject: "herdr",
        composeWorkingDir: "/home/u/herdr-web",
      }) + "\n";
    expect(parseDockerPsOutput(stdout)).toEqual([
      {
        id: "abc123",
        name: "herdr-web-app-1",
        image: "node:20",
        state: "running",
        status: "Up 3 hours",
        createdAt: "c",
        composeProject: "herdr",
        composeService: null,
        composeWorkingDir: "/home/u/herdr-web",
        devcontainerLocalFolder: null,
        ports: [{ host: "8080", container: "80", proto: "tcp" }],
      },
    ]);
  });

  test("ignores a trailing blank line", () => {
    const stdout = `${psLine({ id: "a", names: "n", state: "running", status: "Up", image: "i" })}\n`;
    expect(parseDockerPsOutput(stdout)).toHaveLength(1);
  });
});

describe("groupContainers", () => {
  test("a compose working_dir containing a comma is not split apart, and still ties to root", () => {
    const dirWithComma = `${ROOT}/deploy,staging`;
    const containers = parseDockerPsOutput(
      psLine({
        id: "1",
        names: "app-1",
        state: "running",
        status: "Up",
        image: "node",
        composeProject: "app",
        composeWorkingDir: dirWithComma,
      }),
    );

    const groups = groupContainers(containers, [dirWithComma]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.workingDir).toBe(dirWithComma);
  });

  test("groups compose containers by project and sorts running before others, then by name", () => {
    const containers = parseDockerPsOutput(
      [
        psLine({
          id: "1",
          names: "web-b-1",
          state: "exited",
          status: "Exited (0) 2 hours ago",
          image: "node",
          composeProject: "herdr",
          composeService: "b",
          composeWorkingDir: ROOT,
        }),
        psLine({
          id: "2",
          names: "web-a-1",
          state: "running",
          status: "Up 1 hour",
          image: "node",
          composeProject: "herdr",
          composeService: "a",
          composeWorkingDir: ROOT,
        }),
      ].join("\n"),
    );

    const groups = groupContainers(containers, [ROOT]);
    expect(groups).toEqual([
      {
        kind: "compose",
        name: "herdr",
        workingDir: ROOT,
        containers: [
          {
            id: "2",
            name: "web-a-1",
            service: "a",
            state: "running",
            status: "Up 1 hour",
            image: "node",
            ports: [],
            createdAt: "c",
          },
          {
            id: "1",
            name: "web-b-1",
            service: "b",
            state: "exited",
            status: "Exited (0) 2 hours ago",
            image: "node",
            ports: [],
            createdAt: "c",
          },
        ],
      },
    ]);
  });

  test("groups a devcontainer by the basename of local_folder, with no service", () => {
    const containers = parseDockerPsOutput(
      psLine({
        id: "1",
        names: "vsc-herdr-web-123",
        state: "running",
        status: "Up 1 hour",
        image: "devcontainer",
        devcontainerLocalFolder: ROOT,
      }),
    );

    expect(groupContainers(containers, [ROOT])).toEqual([
      {
        kind: "devcontainer",
        name: "herdr-web",
        workingDir: ROOT,
        containers: [
          {
            id: "1",
            name: "vsc-herdr-web-123",
            service: null,
            state: "running",
            status: "Up 1 hour",
            image: "devcontainer",
            ports: [],
            createdAt: "c",
          },
        ],
      },
    ]);
  });

  test("excludes a container tied to an unrelated root", () => {
    const containers = parseDockerPsOutput(
      psLine({
        id: "1",
        names: "other",
        state: "running",
        status: "Up",
        image: "node",
        composeWorkingDir: "/home/u/other-repo",
      }),
    );
    expect(groupContainers(containers, [ROOT])).toEqual([]);
  });

  test("a container with neither label is excluded", () => {
    const containers = parseDockerPsOutput(
      psLine({ id: "1", names: "bare", state: "running", status: "Up", image: "node" }),
    );
    expect(groupContainers(containers, [ROOT])).toEqual([]);
  });

  test("a sibling directory sharing root as a string prefix does not match", () => {
    const containers = parseDockerPsOutput(
      psLine({
        id: "1",
        names: "other",
        state: "running",
        status: "Up",
        image: "node",
        composeWorkingDir: `${ROOT}-other`,
      }),
    );
    expect(groupContainers(containers, [ROOT])).toEqual([]);
  });
});
