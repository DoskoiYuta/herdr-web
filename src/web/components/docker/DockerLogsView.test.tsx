import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { DockerLogsSocketHandlers } from "@/lib/dockerLogsSocket";

let capturedHandlers: DockerLogsSocketHandlers | null = null;
const closeMock = vi.fn();
const connectDockerLogsSocketMock = vi.fn(
  (_loc: unknown, _opts: unknown, handlers: DockerLogsSocketHandlers): { close: () => void } => {
    capturedHandlers = handlers;
    return { close: closeMock };
  },
);

vi.mock("@/lib/dockerLogsSocket", () => ({
  connectDockerLogsSocket: (...args: unknown[]) =>
    connectDockerLogsSocketMock(args[0], args[1], args[2] as DockerLogsSocketHandlers),
}));

beforeEach(() => {
  capturedHandlers = null;
  connectDockerLogsSocketMock.mockClear();
  closeMock.mockClear();
});

afterEach(() => {
  cleanup();
});

const { DockerLogsView } = await import("./DockerLogsView");

test("a line message from the socket is displayed", async () => {
  render(<DockerLogsView root="/repo" id="abc" />);

  capturedHandlers?.onMessage({ type: "line", stream: "stdout", text: "hello world" });

  expect(await screen.findByText("hello world")).toBeInTheDocument();
});

test("unmounting closes the WebSocket", () => {
  const { unmount } = render(<DockerLogsView root="/repo" id="abc" />);
  expect(connectDockerLogsSocketMock).toHaveBeenCalled();

  unmount();

  expect(closeMock).toHaveBeenCalled();
});
