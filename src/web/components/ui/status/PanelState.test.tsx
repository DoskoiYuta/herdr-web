import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { AlertTriangle } from "lucide-react";
import { PanelState } from "./PanelState";

describe("PanelState", () => {
  test("renders the title and description", () => {
    render(<PanelState icon={AlertTriangle} title="読み込めません" description="詳細メッセージ" />);
    expect(screen.getByText("読み込めません")).toBeInTheDocument();
    expect(screen.getByText("詳細メッセージ")).toBeInTheDocument();
  });

  test("omits the description when not given", () => {
    const { container } = render(<PanelState icon={AlertTriangle} title="タイトルのみ" />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  test("clicking the action button calls onClick", () => {
    const onClick = vi.fn();
    render(<PanelState icon={AlertTriangle} title="失敗" action={{ label: "再試行", onClick }} />);
    fireEvent.click(screen.getByRole("button", { name: "再試行" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  test("omits the action button when not given", () => {
    render(<PanelState icon={AlertTriangle} title="失敗" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  // 無いと壊れる: スクリーンリーダーが失敗/警告状態を能動的に読み上げない
  // （role が無いと単なる静的テキストにしか見えない）。
  test.each([
    ["error" as const, "alert"],
    ["warning" as const, "alert"],
    ["muted" as const, "status"],
    [undefined, "status"],
  ])("tone=%s gets role=%s", (tone, role) => {
    render(<PanelState icon={AlertTriangle} title="状態" tone={tone} />);
    expect(screen.getByRole(role)).toBeInTheDocument();
  });
});
