import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
  render(<DockerLogsView root="/repo" id="abc" name="app-1" />);

  capturedHandlers?.onMessage({ type: "line", stream: "stdout", text: "hello world" });

  expect(await screen.findByText("hello world")).toBeInTheDocument();
});

test("unmounting closes the WebSocket", () => {
  const { unmount } = render(<DockerLogsView root="/repo" id="abc" name="app-1" />);
  expect(connectDockerLogsSocketMock).toHaveBeenCalled();

  unmount();

  expect(closeMock).toHaveBeenCalled();
});

// 無いと壊れる: どのコンテナ・どのコマンドのログを見ているか分からない。
test("shows the docker logs command for this container, including its name", () => {
  render(<DockerLogsView root="/repo" id="abc" name="herdr-web-app-1" />);

  expect(screen.getByText("docker logs --follow --tail 200 herdr-web-app-1")).toBeInTheDocument();
});

// 無いと壊れる: 追従が止まっていることに気づかず、新しい行が来ないと誤解する。
test("switches the follow indicator once the viewer scrolls away from the bottom", () => {
  render(<DockerLogsView root="/repo" id="abc" name="app-1" />);
  expect(screen.getByText("フォロー中")).toBeInTheDocument();

  const scrollable = screen.getByTestId("docker-logs-scroll");
  Object.defineProperty(scrollable, "scrollHeight", { value: 1000, configurable: true });
  Object.defineProperty(scrollable, "clientHeight", { value: 100, configurable: true });
  Object.defineProperty(scrollable, "scrollTop", { value: 0, configurable: true });
  fireEvent.scroll(scrollable);

  expect(screen.getByText("追従を停止中")).toBeInTheDocument();
});
