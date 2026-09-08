import type { Block } from "@contract/decision";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { BlockView } from "./BlockView";

// Stand-ins for @pierre/diffs/react's File/PatchDiff (same pattern as
// DiffPanel.test.tsx / DiffView.test.tsx): the real components mount a
// virtualized renderer + shiki highlighter that isn't worth exercising here
// — this only needs to prove BlockView hands the right content through.
vi.mock("@pierre/diffs/react", () => ({
  File: ({ file }: { file: { contents: string } }) => (
    <div data-testid="pierre-file">{file.contents}</div>
  ),
  PatchDiff: ({ patch, options }: { patch: string; options?: { diffStyle?: string } }) => (
    <div data-testid="pierre-patchdiff" data-diff-style={options?.diffStyle}>
      {patch}
    </div>
  ),
}));

describe.each<[string, Block, () => void]>([
  [
    "code",
    { kind: "code", language: "ts", text: "const answer = 42;" },
    () => expect(screen.getByText("const answer = 42;")).toBeInTheDocument(),
  ],
  [
    "diff",
    { kind: "diff", patch: "diff --git a/f b/f\n+added line\n" },
    () => expect(screen.getByText(/\+added line/)).toBeInTheDocument(),
  ],
  [
    "svg",
    { kind: "svg", markup: "<svg><circle /></svg>" },
    () =>
      expect(document.querySelector("img")!.getAttribute("src")).toMatch(/^data:image\/svg\+xml/),
  ],
  [
    "table",
    {
      kind: "table",
      header: ["a", "b"],
      rows: [
        ["1", "2"],
        ["3", "4"],
      ],
    },
    () => {
      expect(screen.getByRole("table")).toBeInTheDocument();
      expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 data rows
    },
  ],
])("BlockView kind=%s", (_kind, block, assert) => {
  // 無いと壊れる: この Block kind を渡しても対応する DOM が出ず、依頼の
  // context/preview がプレースホルダのまま人間に何も伝わらない。
  test("renders the block's content", () => {
    render(<BlockView block={block} />);
    assert();
  });
});

describe.each<["code" | "diff", (text: string) => Block]>([
  ["code", (text) => ({ kind: "code", language: "ts", text })],
  ["diff", (text) => ({ kind: "diff", patch: text })],
])("%s Block size limit", (_kind, makeBlock) => {
  // 無いと壊れる: 巨大な code/diff がそのままハイライタに渡り、依頼を開いた
  // だけでタブが固まる（描画側に上限が無いことに気づけない）。
  test("falls back to a plain <pre> instead of highlighting when the text exceeds 256 KiB", () => {
    const text = "a".repeat(256 * 1024 + 1);
    render(<BlockView block={makeBlock(text)} />);
    expect(screen.queryByTestId("pierre-file")).not.toBeInTheDocument();
    expect(screen.queryByTestId("pierre-patchdiff")).not.toBeInTheDocument();
    expect(document.querySelector("pre")).toBeInTheDocument();
  });
});

describe("diff Block", () => {
  // 無いと壊れる: split 表示のままだと preview の固定幅でファイル名タブが
  // 折り返され、640px 幅では diff が読めなくなる。
  test("renders in unified diffStyle regardless of viewport", () => {
    render(<BlockView block={{ kind: "diff", patch: "diff --git a/f b/f\n+added line\n" }} />);
    expect(screen.getByTestId("pierre-patchdiff").dataset.diffStyle).toBe("unified");
  });
});

describe("html Block sandbox", () => {
  // 無いと壊れる: allow-same-origin が付くと、依頼が埋め込む任意の html が
  // 同一オリジンの権限（cookie / localStorage / fetch）まで持って実行できてしまう。
  test.each([false, true])("allowScripts=%s never grants allow-same-origin", (allowScripts) => {
    render(<BlockView block={{ kind: "html", html: "<p>hi</p>", allowScripts }} />);
    const iframe = screen.getByTitle("html block");
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
  });

  // 無いと壊れる: allowScripts=false でも埋め込み側の script・インラインハンドラが
  // 実行され、srcdoc に同居する計測スクリプトと同じ権限を持ってしまう。
  test("allowScripts=false admits only the nonce'd measuring script", () => {
    render(<BlockView block={{ kind: "html", html: "<p>hi</p>", allowScripts: false }} />);
    const srcdoc = (screen.getByTitle("html block") as HTMLIFrameElement).getAttribute("srcdoc")!;
    const nonce = /script-src 'nonce-([^']+)'/.exec(srcdoc)?.[1];
    expect(nonce).toBeTruthy();
    expect(srcdoc).not.toMatch(/unsafe-inline/);
    expect(srcdoc).toContain(`<script nonce="${nonce}">`);
  });

  test("allowScripts=true has no CSP so the embedded scripts run", () => {
    render(<BlockView block={{ kind: "html", html: "<p>hi</p>", allowScripts: true }} />);
    const srcdoc = (screen.getByTitle("html block") as HTMLIFrameElement).getAttribute("srcdoc")!;
    expect(srcdoc).not.toMatch(/Content-Security-Policy/);
  });

  // 無いと壊れる: srcdoc 内スクリプトの postMessage を無視したままだと、
  // 中身がどんなに大きくても常に初期の固定高さで表示され続ける。
  test.each([false, true])(
    "allowScripts=%s grows to the height reported by the srcdoc's own postMessage",
    (allowScripts) => {
      render(<BlockView block={{ kind: "html", html: "<p>hi</p>", allowScripts }} />);
      const iframe = screen.getByTitle("html block") as HTMLIFrameElement;
      fireEvent(
        window,
        new MessageEvent("message", {
          data: { source: "herdr-html-block", height: 321 },
          source: iframe.contentWindow,
        }),
      );
      expect(iframe.style.height).toBe("321px");

      // 無いと壊れる: 依頼が埋め込む html が任意の height を送れてしまい、
      // 依頼ビュー全体をその値まで伸ばせてしまう。
      fireEvent(
        window,
        new MessageEvent("message", {
          data: { source: "herdr-html-block", height: 1e9 },
          source: iframe.contentWindow,
        }),
      );
      expect(iframe.style.height).toBe("4000px");
    },
  );
});

describe("image Block", () => {
  // 無いと壊れる: root/path が URL に反映されず、依頼の image が常に別の
  // worktree のファイルを指すか、そもそも解決できない。
  test("src carries root and path", () => {
    render(<BlockView block={{ kind: "image", path: "docs/a.png" }} worktreeRoot="/repo" />);
    const src = screen.getByRole("img").getAttribute("src")!;
    expect(src).toContain(encodeURIComponent("/repo"));
    expect(src).toContain(encodeURIComponent("docs/a.png"));
  });

  // 無いと壊れる: worktree が不明な依頼で image を出そうとして壊れた
  // (存在しない) URL の <img> を出し、失敗が沈黙してしまう。
  test("shows a message instead of an <img> when worktreeRoot is unknown", () => {
    render(<BlockView block={{ kind: "image", path: "docs/a.png" }} worktreeRoot={null} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/表示できません/)).toBeInTheDocument();
  });

  // 無いと壊れる: 存在しないパスの image でも壊れた <img> がそのまま
  // 残り、依頼を見た人に読み込み失敗が伝わらない。
  test("shows a message instead of the broken <img> when it fails to load", () => {
    render(<BlockView block={{ kind: "image", path: "docs/missing.png" }} worktreeRoot="/repo" />);
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("画像を読み込めません: docs/missing.png")).toBeInTheDocument();
  });

  // 無いと壊れる: context が入れ替わっても同じ index の image が同一の React
  // 要素として再利用され、前の画像の読み込み失敗表示が新しい path のまま残る。
  test("clears the previous path's error state when the path changes", () => {
    const { rerender } = render(
      <BlockView block={{ kind: "image", path: "docs/missing.png" }} worktreeRoot="/repo" />,
    );
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByText("画像を読み込めません: docs/missing.png")).toBeInTheDocument();

    rerender(<BlockView block={{ kind: "image", path: "docs/ok.png" }} worktreeRoot="/repo" />);
    expect(screen.queryByText(/読み込めません/)).not.toBeInTheDocument();
    expect(screen.getByRole("img")).toBeInTheDocument();
  });
});

describe("location Block", () => {
  // 無いと壊れる: location をクリックしても Files タブへのジャンプが起こらず、
  // 依頼の中から実ファイルを見に行く手段が無い。
  test("clicking calls onOpenLocation with path and lines", () => {
    const onOpenLocation = vi.fn();
    const { getByText } = render(
      <BlockView
        block={{ kind: "location", path: "src/a.ts", lines: [3, 5] }}
        worktreeRoot="/repo"
        onOpenLocation={onOpenLocation}
      />,
    );
    fireEvent.click(getByText(/src\/a\.ts/));
    expect(onOpenLocation).toHaveBeenCalledWith({
      worktreeRoot: "/repo",
      path: "src/a.ts",
      lines: [3, 5],
    });
  });

  // 無いと壊れる: 1 行だけを指す location が ":L5–5" という無意味な範囲
  // 表記になり、依頼を見た人に単一行だと伝わらない。
  test("shows a single line number instead of a same-line range", () => {
    render(<BlockView block={{ kind: "location", path: "src/a.ts", lines: [5, 5] }} />);
    expect(screen.getByText(":L5")).toBeInTheDocument();
  });
});

describe("mermaid Block", () => {
  // 無いと壊れる: mermaid の描画結果が画面に反映されず、mermaid 図が
  // 常に空欄のまま人間に見えない。
  test("renders the SVG returned by mermaid.render", async () => {
    vi.doMock("mermaid", () => ({
      default: {
        initialize: vi.fn(),
        render: vi.fn().mockResolvedValue({ svg: "<svg data-testid='mermaid-svg'></svg>" }),
      },
    }));
    render(<BlockView block={{ kind: "mermaid", text: "graph TD; A-->B;" }} />);
    await waitFor(() => expect(document.querySelector("[data-testid='mermaid-svg']")).toBeTruthy());
    vi.doUnmock("mermaid");
  });
});
