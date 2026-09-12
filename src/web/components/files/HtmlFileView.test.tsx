import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { HtmlFileView } from "./HtmlFileView";

test("scripts stay disabled by default: sandbox has no tokens, and the file contents follow a CSP meta in the srcDoc", () => {
  render(<HtmlFileView contents="<h1>hi</h1>" />);
  const iframe = screen.getByTitle("HTML preview");
  expect(iframe).toHaveAttribute("sandbox", "");
  const srcDoc = iframe.getAttribute("srcdoc") ?? "";
  expect(srcDoc).toContain("<h1>hi</h1>");
  expect(srcDoc.indexOf("Content-Security-Policy")).toBeLessThan(srcDoc.indexOf("<h1>hi</h1>"));
});

test("allowing scripts grants allow-scripts only, never allow-same-origin", () => {
  render(<HtmlFileView contents="<h1>hi</h1>" />);
  fireEvent.click(screen.getByRole("button", { name: "スクリプトを許可" }));
  const iframe = screen.getByTitle("HTML preview");
  expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
});
