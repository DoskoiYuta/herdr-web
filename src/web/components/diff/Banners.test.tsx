import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import Banners from "./Banners.tsx";

test("renders nothing for no banners", () => {
  const { container } = render(
    <Banners updateBanner={null} errorText={null} untrackedTruncated={false} onUpdate={() => {}} />,
  );
  expect(container.querySelectorAll(".banner").length).toBe(0);
});

test("renders an update banner with a working refresh button", () => {
  const onUpdate = vi.fn();
  render(
    <Banners
      updateBanner={{ text: "変更があります", hash: "h1" }}
      errorText={null}
      untrackedTruncated={false}
      onUpdate={onUpdate}
    />,
  );
  expect(screen.getByText("変更があります")).toBeInTheDocument();
  fireEvent.click(screen.getByText("↻ 更新 (r)"));
  expect(onUpdate).toHaveBeenCalledOnce();
});

test("renders an error banner", () => {
  render(
    <Banners
      updateBanner={null}
      errorText="patch 取得に失敗しました"
      untrackedTruncated={false}
      onUpdate={() => {}}
    />,
  );
  expect(screen.getByText("patch 取得に失敗しました")).toBeInTheDocument();
});

test("renders an untracked-truncated banner", () => {
  render(
    <Banners updateBanner={null} errorText={null} untrackedTruncated={true} onUpdate={() => {}} />,
  );
  expect(screen.getByText("未追跡ファイルが多いため一部省略されています")).toBeInTheDocument();
});
