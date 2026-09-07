import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DockerContainersResponse } from "@contract/docker";

const containersMock = vi.fn<(root: string) => Promise<DockerContainersResponse>>();

vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  dockerApi: { containers: (...args: [string]) => containersMock(...args) },
}));

// DockerLogsView opens a real WebSocket on mount (F11-9) — irrelevant to
// ComposePanel's own job of toggling which row is expanded.
vi.mock("./DockerLogsView", () => ({
  DockerLogsView: ({ id }: { root: string; id: string }) => <div>logs:{id}</div>,
}));

const { CommandUnavailableError, CommandTimeoutError } = await import("@/lib/api");
const { ComposePanel } = await import("./ComposePanel");

function renderPanel(root = "/repo"): ReactElement {
  const client = new QueryClient();
  return (
    <QueryClientProvider client={client}>
      <ComposePanel root={root} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

test("no matching containers shows the empty-state message rather than a bare empty list", async () => {
  containersMock.mockResolvedValue({ groups: [] });
  render(renderPanel());

  expect(
    await screen.findByText(
      "この worktree に紐づくコンテナはありません（compose / devcontainer のラベルで判定）",
    ),
  ).toBeInTheDocument();
});

test("renders a group's containers with service, state, and ports", async () => {
  containersMock.mockResolvedValue({
    groups: [
      {
        kind: "compose",
        name: "herdr",
        workingDir: "/repo",
        containers: [
          {
            id: "1",
            name: "herdr-web-1",
            service: "web",
            state: "running",
            status: "Up 3 hours",
            image: "node:20",
            ports: [{ host: "8080", container: "80", proto: "tcp" }],
            createdAt: "c",
          },
        ],
      },
    ],
  });
  render(renderPanel());

  expect(await screen.findByText("web")).toBeInTheDocument();
  expect(screen.getByText("herdr-web-1")).toBeInTheDocument();
  expect(screen.getByText("8080→80/tcp")).toBeInTheDocument();
});

test("a container with no published ports shows a placeholder instead of a blank cell", async () => {
  containersMock.mockResolvedValue({
    groups: [
      {
        kind: "compose",
        name: "herdr",
        workingDir: "/repo",
        containers: [
          {
            id: "1",
            name: "herdr-web-1",
            service: "web",
            state: "running",
            status: "Up",
            image: "node",
            ports: [],
            createdAt: "c",
          },
        ],
      },
    ],
  });
  render(renderPanel());

  expect(await screen.findByText("—")).toBeInTheDocument();
});

test("groups one project's containers under a card showing running/exited counts", async () => {
  containersMock.mockResolvedValue({
    groups: [
      {
        kind: "compose",
        name: "herdr",
        workingDir: "/repo",
        containers: [
          {
            id: "1",
            name: "herdr-web-1",
            service: "web",
            state: "running",
            status: "Up",
            image: "node",
            ports: [],
            createdAt: "c",
          },
          {
            id: "2",
            name: "herdr-db-1",
            service: "db",
            state: "exited",
            status: "Exited (0)",
            image: "postgres",
            ports: [],
            createdAt: "c",
          },
        ],
      },
    ],
  });
  render(renderPanel());

  expect(await screen.findByText("1 running · 1 exited")).toBeInTheDocument();
});

test.each([
  ["compose", "docker compose"],
  ["devcontainer", "devcontainer"],
] as const)("shows the %s kind chip", async (kind, label) => {
  containersMock.mockResolvedValue({
    groups: [
      {
        kind,
        name: "herdr",
        workingDir: "/repo",
        containers: [
          {
            id: "1",
            name: "herdr-web-1",
            service: kind === "compose" ? "web" : null,
            state: "running",
            status: "Up",
            image: "node",
            ports: [],
            createdAt: "c",
          },
        ],
      },
    ],
  });
  render(renderPanel());

  expect(await screen.findByText(label)).toBeInTheDocument();
});

test("clicking a container row opens its log view, and clicking it again closes it", async () => {
  containersMock.mockResolvedValue({
    groups: [
      {
        kind: "compose",
        name: "herdr",
        workingDir: "/repo",
        containers: [
          {
            id: "1",
            name: "herdr-web-1",
            service: "web",
            state: "running",
            status: "Up",
            image: "node",
            ports: [],
            createdAt: "c",
          },
        ],
      },
    ],
  });
  render(renderPanel());
  const row = await screen.findByText("herdr-web-1");

  fireEvent.click(row);
  expect(await screen.findByText("logs:1")).toBeInTheDocument();

  fireEvent.click(row);
  expect(screen.queryByText("logs:1")).not.toBeInTheDocument();
});

test("docker missing (CommandUnavailableError) shows a header error", async () => {
  containersMock.mockRejectedValue(new CommandUnavailableError("docker が見つかりません"));
  render(renderPanel());

  expect(await screen.findByText(/docker が見つかりません/)).toBeInTheDocument();
});

test("an empty root does not call the API and shows a placeholder instead", () => {
  render(renderPanel(""));

  expect(screen.getByText("worktree を選択してください")).toBeInTheDocument();
  expect(containersMock).not.toHaveBeenCalled();
});

test("a later poll failure keeps the previous container list visible while showing the header error", async () => {
  containersMock
    .mockResolvedValueOnce({
      groups: [
        {
          kind: "compose",
          name: "herdr",
          workingDir: "/repo",
          containers: [
            {
              id: "1",
              name: "herdr-web-1",
              service: "web",
              state: "running",
              status: "Up",
              image: "node",
              ports: [],
              createdAt: "c",
            },
          ],
        },
      ],
    })
    .mockRejectedValueOnce(new CommandTimeoutError("docker ps がタイムアウトしました"));

  const client = new QueryClient();
  const { rerender } = render(
    <QueryClientProvider client={client}>
      <ComposePanel root="/repo" />
    </QueryClientProvider>,
  );
  await screen.findByText("herdr-web-1");

  await client.refetchQueries({ queryKey: ["docker-containers", "/repo"] }).catch(() => {});
  rerender(
    <QueryClientProvider client={client}>
      <ComposePanel root="/repo" />
    </QueryClientProvider>,
  );

  expect(await screen.findByText(/docker ps がタイムアウトしました/)).toBeInTheDocument();
  expect(screen.getByText("herdr-web-1")).toBeInTheDocument();
});
