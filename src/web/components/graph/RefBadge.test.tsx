import { render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import RefBadge from "./RefBadge";

describe("RefBadge", () => {
  test("renders the ref name", () => {
    const { getByText } = render(<RefBadge name="main" type="head" isHead={true} />);
    expect(getByText("main")).toBeInTheDocument();
  });

  test("renders each ref type without throwing", () => {
    for (const type of ["head", "remote", "tag", "stash"] as const) {
      const { getByText, unmount } = render(
        <RefBadge name={`n-${type}`} type={type} isHead={false} />,
      );
      expect(getByText(`n-${type}`)).toBeInTheDocument();
      unmount();
    }
  });
});
