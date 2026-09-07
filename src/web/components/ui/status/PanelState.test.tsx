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
});
