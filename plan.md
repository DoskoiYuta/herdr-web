# herdr Web UI — 設計・要件定義書

> 2026-09-09: ツール領域の worktree 追従（`foreground_cwd` から推定、`hw worktree use` の宣言）は
> [docs/ui-redesign.md §10](docs/ui-redesign.md) で「ワークスペース単位の選択」に置き換えた。
> 本書の `foreground_cwd` / `hw worktree` に関する記述は履歴として残している。

## 1. 概要

ローカル（または SSH 先）で動作している herdr（tmux 系のエージェント向けターミナルマルチプレクサ）に、ブラウザから attach し、その横でエージェントの成果をレビューするための自作 Web UI を作る。

構成は 3 つの領域からなる。

- **サイドバー**: herdr の workspace / pane / agent 状態を、**git リポジトリ単位でグルーピング** して表示する。herdr 自身のサイドバーは設定で非表示にし、Web UI 側のサイドバーで置き換える。worktree が増えても「どのリポジトリの、どのブランチで、誰が何をしているか」が一目で追えるようにする。
- **ターミナル領域**: herdr 本体の TUI を PTY 経由で xterm.js に描画する。タブ・pane 操作・worktree 管理はすべて herdr と、その中で動くエージェントに任せる。
- **ツール領域**: herdr でフォーカスされている pane の **エージェントの cwd**（`foreground_cwd`）に自動追従し、その git リポジトリの **diff ビューア** と **git graph** を表示する。diff に **レビュー**（注釈）を付け、エージェントが CLI で読み取り・返答できる。

## 2. 役割分担の原則

| 責務                                                                                                                          | 担当                   |
| ----------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| workspace / worktree / pane のライフサイクル、エージェントの起動・状態管理、pane への入力                                     | herdr                  |
| worktree の作成・切り替え（EnterWorktree / ExitWorktree）、実装                                                               | Claude Code（pane 内） |
| 全体を見渡す・移動する（リポジトリ単位のサイドバー、フォーカス切り替え）、成果を見る・判断する・返す（diff、graph、レビュー） | Web UI                 |
| herdr の CLI と Web UI の CLI（`hw`）を叩いて両者をつなぐ                                                                     | エージェント自身       |

Web UI は herdr の状態を **読む** ことを基本とし、worktree の作成や pane の起動は行わない。Web UI から herdr への「書き込み」は、サイドバーからのフォーカス切り替え（`workspace.focus` / `pane.focus`）、サイドバーからのワークスペース作成・改名・削除（`workspace.create` / `workspace.rename` / `workspace.close`）、レビュー通知としての `agent.prompt` の 3 種のみ。

## 3. 前提・背景

### herdr（確認済み: 0.8.2, protocol 20）

- バックグラウンドのセッションサーバー + ターミナルクライアントの構成。クライアントが切断してもサーバー側の pane は生き続ける。
- ローカル Unix ドメインソケット（既定 `~/.config/herdr/herdr.sock`、NDJSON）で socket API を公開。Web UI サーバーは `node:net` で直接接続し、ブラウザには WebSocket で中継する。`herdr api schema --json` で JSON Schema（`request` / `success_response` / `error_response` / `event` / `subscription_event`）を取得できる。
- `session.snapshot` は `{ agents, panes, tabs, workspaces, layouts, focused_pane_id, focused_tab_id, focused_workspace_id, protocol, version }` を返す。**pane レコードに `foreground_cwd` と `agent_session` が含まれる**（§12-10 確認済み）。
- `agent_session` は `{ source, agent, kind: "id" | "path", value }`。公式 Claude Code 連携では `source: "herdr:claude"`, `agent: "claude"`, `kind: "id"`, `value: <Claude Code セッション UUID>`（§12-7 確認済み）。他エージェントは `pane.report_agent_session` で報告されれば取れる。
- **ワイヤ形式（M2 で実機確認）**: リクエスト `{id, method, params}`、応答 `{id, result}` / `{id, error: {code, message}}`。購読フレームは `{event, data}` で、`data.type` は `pane_updated` のようにアンダースコア区切り、`events.subscribe` の `subscriptions` に渡す名前は `pane.updated` のようにドット区切り。
- **1 接続 1 リクエスト**: herdr は通常のリクエストに応答した直後に接続を閉じる。長寿命なのは `events.subscribe` の接続だけ。socket-client はリクエストごとに接続を張り直す。
- `pane.agent_status_changed` の購読には `pane_id` が必須（全 pane 一括では購読できない）。状態変化は `pane_updated` が `agent_status` を含むのでそちらで拾う。
- `agent.prompt` の失敗は `agent_blocked` / `agent_prompt_stalled` というエラーコードで返る。成功は `{type: "agent_prompted", agent}`。`pane.focus` / `pane.get` の応答は `{type: "pane_info", pane}`。
- herdr は `pane_focused` / `workspace_focused` / `tab_focused` / `layout_updated` を毎秒数回送ることがある。focus / tree の配信は内容が変わったときだけ行う。
- pane 内プロセスは `HERDR_ENV`、`HERDR_PANE_ID`、`HERDR_WORKSPACE_ID`、`HERDR_TAB_ID`、`HERDR_SOCKET_PATH`、`HERDR_BIN_PATH` を継承する。
- `agent.prompt` はプロンプト送信と待機を 1 リクエストで行い、エージェントが `blocked` なら送信せず `agent_blocked` を返す。
- herdr サイドバーは `~/.config/herdr/config.toml` の `[ui] sidebar_collapsed_mode = "hidden"` で非表示にできる（§12-8 確認済み）。

### Claude Code

- 会話の途中で「worktree で作業して」と指示すると、EnterWorktree ツールで `.claude/worktrees/<name>` に新ブランチの worktree を作り、セッションの cwd をそこへ移す。ExitWorktree で戻れる。
- したがって「herdr の workspace は main を指し、その中の Claude だけが worktree に居る」状態が通常運用になる。

### 移植元（§12-6 確認済み）

- diff ビューア: `../terminal-diff`（tdiff）。`@pierre/diffs` の `CodeView` を使い、「patch 全文 + ファイル毎の blob ハッシュ」を返し、hunk 展開時に blob ハッシュで全文をハイドレーションする 2 段構え。純粋な `reconcile.ts` / `tree.ts` と `DiffView.tsx` / `FileTree.tsx` / `ResizeHandle.tsx` / `StatusLine.tsx` はそのまま移植できる。サーバー側の `git.ts` / `patch.ts` / `splitPatch.ts` / `files.ts` / `augmentArgs.ts` も `execFile` ベースで Bun にそのまま載る。
- git graph: `../terminal-git-graph`（tgg）。`src/shared/graph/{layout,path,colors}.ts` は純関数。`GraphView.tsx`（react-virtual）/ `GraphRow.tsx` / `CommitDetail.tsx` を移植。コミットの diff 本文は持たない（tdiff 側に渡す）。`ops.ts`（fetch / pull）は持ち込まない。
- 両者とも変更検知は 1 秒間隔の git ポーリング、配信は SSE。本リポジトリでは配信を `/ws/events` に統合する。
- terminal-browser 関連（`bin/*.ts` の spawn、`preload.cjs`、`*:quit` イベント、クライアント 0 での自動終了、instance UUID）は持ち込まない。

### その他

- 開発環境: macOS / Linux。ランタイムは Bun 1.4。

## 4. スコープ

### 含む

- ブラウザから herdr TUI へ attach（入力・出力・リサイズ・再接続）
- リポジトリ単位でグルーピングしたサイドバー（workspace / worktree / pane / agent 状態、フォーカス切り替え）。サイドバーからのワークスペース作成（リポジトリ見出しの「+」→ label 入力 → その main worktree root を cwd に `workspace.create`）と、ワークスペース行の右クリックメニューからの改名（`workspace.rename`）・削除（`workspace.close`、pane/agent 終了の確認あり）
- フォーカス pane の `foreground_cwd` の追跡と git ルートの解決
- 内蔵 diff ビューア（作業ツリー / ステージ / 任意コミット間）とファイルツリー（tdiff から移植するため含める）
- 内蔵 git graph（コミットグラフ、ブランチ、コミット選択 → diff 連携）
- diff へのレビュー（worktree / コミットへの紐付け、内容アンカー、スレッド、下書き + 送信、状態管理）と、エージェント向け CLI `hw`
- 送信操作による `agent.prompt` エージェント通知
- git graph 上のコミットごとのレビュー件数バッジ
- 読み取り専用のファイルビューア（ファイルツリー + 単一ファイル表示、Markdown はプレビュー）
- 単一プロセス・単一コマンドでの開発起動、単一バイナリへのビルド
- `127.0.0.1` バインドのまま `tailscale serve` 経由で tailnet から利用できること

### 含まない（初期スコープ外）

- herdr 自身のサイドバーの制御
- 外部 Web アプリの iframe 埋め込み、リンク集、ブラウザ機能
- worktree の作成・削除（ワークスペースの作成・改名・削除はサイドバーから可能。§2, §7 F8 参照）
- herdr の内部 render socket への直接接続
- 認証・公開運用（アクセス制御は Tailscale の ACL に委ねる）
- git の書き込み操作（stage / commit / checkout / pull）。ただし `git fetch --prune`（リモート追跡ブランチ `refs/remotes/*` の更新のみ、worktree は変更しない）は Graph から実行できる（§7 F4 参照）
- レビューの MCP サーバー化

## 5. 技術スタック

| 領域            | 選定                                                                               | 備考                                                                                         |
| --------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| ランタイム      | Bun 1.4                                                                            | 開発・本番とも                                                                               |
| HTTP            | Hono + `@hono/node-server` の `getRequestListener`                                 | `node:http` の `createServer` をホストにし、`ws` を attach                                   |
| 型付き API      | **Hono RPC**（`hc`）+ `@hono/valibot-validator`                                    | browser と `hw` CLI が同じ `AppType` からクライアントを作る。oRPC は採用しない               |
| WebSocket       | `ws`                                                                               | `/ws/term`、`/ws/events`                                                                     |
| PTY             | **`bun-pty`**（bun:ffi + Rust）                                                    | node-pty は Bun 1.4 で onData が届かず不採用（§12-4 で確認）                                 |
| herdr 接続      | `node:net` + NDJSON                                                                | 型は `herdr api schema --json` から必要分を valibot で手書き                                 |
| git             | `git` CLI を `child_process.execFile` で呼ぶ（tdiff / tgg の `runGit` を移植）     | 読み取り専用、`LC_ALL=C`                                                                     |
| 永続化          | **SQLite（`bun:sqlite`）+ drizzle-orm**                                            | レビューとリポジトリ登録。`~/.config/herdr-web/herdr-web.db`、WAL                            |
| スキーマ / 検証 | **valibot**                                                                        | 設定ファイル、REST、WS メッセージ、herdr NDJSON、DB 行の 5 境界で parse                      |
| エラー          | **neverthrow**                                                                     | review のドメイン・ユースケース層のみ。アダプタは throw し、境界で `ResultAsync.fromPromise` |
| 分岐            | **ts-pattern**                                                                     | herdr イベント、WS メッセージ、レビュー状態遷移を `.exhaustive()` で                         |
| フロント        | React 19 + Vite（SPA）+ **shadcn/ui**（Tailwind v4）                               | ルーティング不要                                                                             |
| ターミナル      | `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`, `@xterm/addon-clipboard` |                                                                                              |
| diff / graph    | `@pierre/diffs`、tgg のレイアウト（自前）                                          |                                                                                              |
| Lint / Format   | **oxlint / oxfmt**                                                                 | 型チェックは `tsc --noEmit` を別に持つ                                                       |
| 依存方向        | **dependency-cruiser**                                                             | §6.7 の境界を CI で検証                                                                      |
| テスト          | `bun test`（server、contract）、Vitest + jsdom（web）                              | git は一時リポジトリで実走。herdr はフェイクゲートウェイ                                     |
| ビルド          | `vite build` + `bun build --compile`                                               | 静的ファイルと drizzle マイグレーション SQL を同梱                                           |

## 6. アーキテクチャ

### 6.1 全体構成

```
ブラウザ (React)
 ┌────────────┬──────────────────────────┬──────────────────────────────┐
 │ サイドバー   │ ターミナル (xterm.js)      │ ツール領域                     │
 │ repo A      │  herdr TUI                 │  [Diff] [Graph] [Review] 📌    │
 │  ├ main     │                            │  foreground_cwd の worktree     │
 │  │  └ ● sh  │                            │                                │
 │  └ feat/x   │                            │                                │
 │     └ ◉ cc  │                            │                                │
 └────────────┴──────────────────────────┴──────────────────────────────┘
   │ WS /ws/events         │ WS /ws/term               │ Hono RPC /api/*
   ▼                       ▼                           ▼
Web UI サーバー (Bun, 単一プロセス, 127.0.0.1:8080)
   ├─ terminal: bun-pty で herdr を spawn (接続ごとに 1 PTY)
   ├─ herdr:    HerdrGateway (socket 実装 / フェイク) → state (snapshot + events) → tree / focus
   ├─ git:      runGit + parsers (patch / files / log / refs / detail) + poller
   ├─ review:   domain (純粋) + usecases + adapters (sqlite / herdr-notifier / git-blame)
   └─ events:   /ws/events のブロードキャスト
        │
        ▼
herdr サーバー (~/.config/herdr/herdr.sock)
        │
        ▼ (pane 内)
Claude Code ── hw review list / show / reply ──▶ Web UI サーバー
```

### 6.2 プロセス構成

- サーバーは 1 プロセス。開発時は `bun run dev` の 1 コマンドで、Vite の HMR・REST・WS がすべて同一ポートで動く（Vite は `middlewareMode: true, appType: "spa"`）。
- 本番時は `vite build` の成果物を同じサーバーから配信する。
- WS は `ws` を `http.Server` に attach するため、開発・本番でコードが分岐しない。

### 6.3 ターミナルの方式（PTY attach）

- Web UI サーバーが `bun-pty` で `herdr` を spawn し、herdr TUI 全体を xterm.js に流す。herdr の内部プロトコルに依存しない。

### 6.4 フォーカス追従の方式

1. 接続時に `session.snapshot` でフォーカス中の pane と全 pane レコードを取得する（`foreground_cwd` 込み）。
2. `events.subscribe` で `pane.focused`、`workspace.focused`、`pane.updated`、`pane.agent_status_changed`、`pane.closed` 等を購読する。
3. フォーカス pane が変わった時、および同じ pane で `pane.updated` / `pane.agent_status_changed` を受けた時に `foreground_cwd`（なければ `cwd`）を取る。
4. `git -C <cwd> rev-parse --show-toplevel` で worktree ルートを求め、変わった時だけツール領域を切り替える。
5. `foreground_cwd` の変化が `pane.updated` を発火させない場合に備え、フォーカス pane に対してのみ低頻度（既定 3 秒）の `pane.get` ポーリングをフォールバックとして持つ（§12-1）。
6. ツール領域は常に herdr のフォーカスに追従する。固定表示（ピン留め）は持たない。複数ブラウザ・複数タブでも herdr の状態が唯一の正で、ブラウザ側に独自の選択状態を持たせない。
7. pane 内のエージェントが `hw worktree use` で宣言した worktree はその pane の cwd として扱う（人間が UI で固定するピン留めとは別）。

### 6.5 レビューのモデル（所有・可視性・通知）

レビューは **エージェントではなく変更に付く**。3 つの概念を分ける。

| 概念                 | 意味                                                                         | 保存するか         |
| -------------------- | ---------------------------------------------------------------------------- | ------------------ |
| アンカー先（所有者） | どの変更に付いているか。未コミットなら **worktree**、コミット後は **commit** | する               |
| 可視性               | どのエージェントに見えるか。「今いる worktree」から決まる                    | しない（都度計算） |
| 通知先               | 作成時に誰へ `agent.prompt` するか                                           | しない（都度解決） |

**アンカー先は 2 段階**

- 作成時に見ていた diff が作業ツリー / index なら `target = { kind: "worktree", root }`。
- コミットの diff なら `target = { kind: "commit", hash }` で即確定。
- worktree 付きのレビューは、`repo-changed` を受けた再アンカー（F5-4）で導入コミットが判明したら `commit` に移る。`worktreeRoot` は履歴として残す。

**可視性（`hw review list` の既定）**: 呼び出し元 pane の `foreground_cwd` → worktree ルートを解決し、

- その worktree に付いた未コミットのレビュー、および
- commit 確定済みで、その commit が worktree の HEAD から到達可能（`git merge-base --is-ancestor`）なレビュー

のうち `open` / `replied` を返す。レビュー対応をコミットしても、以前の commit に付いた未解決レビューは HEAD の祖先である限り出続ける。消えるのは resolve されたときだけ。

**通知先**: 送信操作（下書きの一括送信）を受けたときに、そのレビューの worktree（commit 付きの場合は、その commit を HEAD に含む worktree）を `foreground_cwd` に持つ pane を探し、フォーカス pane が含まれればそこへ、無ければ最初のエージェント pane へ `agent.prompt` する。無ければ「未通知」。通知先は保存せず、再送時に再解決する。

**壊れ方**

| 事象                                            | 結果                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| worktree が削除された                           | 未コミットのレビューは `outdated`。git graph のバッジ集計にだけ残る                                 |
| 変更を破棄 / stash した                         | 再アンカーで行が見つからず `outdated`。戻せば再アンカーで復活                                       |
| commit 確定後に対応コミットで行が書き換えられた | commit 付きレビューは **`outdated` にしない**。元 commit の diff に表示され続ける                   |
| rebase / squash で commit が到達不能になった    | 再アンカー時に内容一致で新 commit を探し直す。見つからなければ `outdated`。`--unreachable` で引ける |

### 6.6 サイドバーのデータモデル（リポジトリ単位の再構成）

herdr の階層は `workspace > tab > pane` だが、サイドバーは `repository > worktree > pane` で表示する。

| 解決するもの             | 方法                                                                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| worktree ルート          | `foreground_cwd`（なければ `cwd`）に `git rev-parse --show-toplevel`                                             |
| リポジトリのグループキー | `git rev-parse --git-common-dir` の絶対パス                                                                      |
| worktree の表示名        | `git rev-parse --abbrev-ref HEAD`（detached なら短縮 hash）。main か linked かは `git worktree list --porcelain` |
| pane の表示              | `label`、`agent`、`agent_status`、`terminal_title_stripped`、所属 workspace / tab                                |

- 解決結果は cwd ごとにキャッシュし、イベントを受けた pane だけ再解決する。
- git 管理外の cwd は「その他」グループ。
- リポジトリごとに `blocked` / `done` の件数をバッジ表示。
- 表示モードを `repository`（既定）と `workspace` で切り替えられる。

### 6.7 コードの層と依存方向（dependency-cruiser で検証）

ヘキサゴナルは **review だけ** に適用する。他は I/O そのものでポートを切っても 1 実装しか持たないため、モジュール分割にとどめる。

```
src/contract   ← 誰からも import 可（valibot スキーマ、Hono RPC の AppType、owner / repo キー関数、WS メッセージ型）
src/server/review/domain     → contract のみ import 可（純粋: Annotation、遷移、アンカー一致）
src/server/review/ports.ts   → domain, contract
src/server/review/usecases   → domain, ports, contract（neverthrow）
src/server/review/adapters   → ports, contract, server/git, server/herdr（usecases を import しない）
src/server/herdr/gateway.ts  → ポート（socket 実装とフェイク）
src/web                      → contract のみ（server を import しない）
src/cli                      → contract のみ
```

## 7. 機能要件

### F1. ターミナル

- F1-1. WS 接続 1 本につき PTY を 1 つ spawn する。切断時に PTY を kill する。
- F1-2. spawn コマンドは `herdr`。`?session=<name>` で `herdr --session <name>`。
- F1-3. `env` は `process.env` から `HERDR_` で始まる変数を除いたものを渡す。`TERM` は `xterm-256color`。
- F1-4. xterm.js 側のサイズ変更を `pty.resize()` に反映する。接続直後に必ず 1 回 resize を送る。
- F1-5. 入力は UTF-8 のまま `pty.write` に渡す。
- F1-6. WS 切断時、フロントは再接続ボタンで新しい PTY を作る。
- F1-7. 複数タブはそれぞれ独立した herdr クライアントになる。
- F1-8. ターミナル領域とツール領域の境界はドラッグでリサイズできる。ツール領域は折りたたみ可能。

### F2. フォーカス追従

- F2-1. §6.4 の手順で、フォーカス pane の `foreground_cwd` と worktree ルートをイベント WS でブラウザへ通知する。
- F2-2. フォーカス pane の `agent_session` を表示し、Claude Code のセッション ID なら `claude --resume <id>` のコピー導線を出す。
- F2-3. herdr 未接続時はツール領域に「herdr 未接続」を表示する。手動でパスを入力して開くフォールバックは持たない（herdr の付属 UI であり、herdr 無しで使う想定をしない）。
- F2-4. ピン留め（追従の一時停止）は持たない。理由: 固定先をサーバーが 1 つしか持てず複数タブで衝突する、固定中は git poller の監視対象と `repoKey` が focus 側とずれる、URL に固定 root を持つと「サーバーは追従・ブラウザだけ固定」の中途半端な状態になる。別 worktree を見たいときは herdr 側でその workspace / pane にフォーカスする（F8-3）。

### F3. diff ビューア（tdiff から移植）

- F3-1. 変更ファイル一覧（未ステージ / ステージ / 未追跡、上限 200）とファイルツリー（`@pierre/trees` ベースの共通 `PathTree` コンポーネント、F4/F9 のツリーと共有）。
- F3-2. unified / side-by-side。狭幅では unified に自動切替。シンタックスハイライトは `@pierre/diffs`。
- F3-3. 比較対象: 作業ツリー vs HEAD（既定、staged + unstaged）、ステージ vs HEAD、任意の 2 commit（F4 から渡す）。
- F3-4. 変更検知は 1 秒間隔の git ポーリング（tdiff の poller）。フォーカス中の worktree だけをポーリングし、`repo-changed` を配信する。
- F3-5. バイナリは要約表示。
- F3-6. 行または行範囲（複数行）を選択してレビューを付けられる（F5）。現在表示中の diff にアンカーが一致するレビューを該当範囲にインライン表示する。

### F4. git graph（tgg から移植）

- F4-1. DAG レーン描画、ブランチ・タグ、HEAD、未コミット変更の擬似ノード。
- F4-2. 既定で直近 N コミット（設定可）、「さらに読み込む」で倍増。
- F4-3. コミットを選ぶとそのコミットの diff を F3 に表示する。2 つ選ぶと範囲 diff。
- F4-4. 全ブランチ / 現在ブランチのみ。
- F4-5. fetch ボタン（キー `f`）で `git fetch --prune` を実行し、origin の最新状態（リモート追跡ブランチ）をグラフに反映する。worktree は変更しない。実行中はボタンを disable し、完了後に結果（所要時間、失敗時は stderr 先頭行、ビジー、タイムアウト）を数秒間表示する。

### F5. レビュー

- F5-1. データ:
  - `id`: ULID
  - `repo`: リポジトリキー（`git-common-dir` の絶対パス。F7 の `repos` テーブルを参照）
  - `target`: `{ kind: "worktree", root }` または `{ kind: "commit", hash }`
  - `worktreeRoot`: 作成時の worktree（履歴用、commit 確定後も残す）
  - `path`: リポジトリルートからの相対パス
  - `anchor`: 内容アンカー（F5-2）
  - `createdAtHead`: 作成時の HEAD
  - `viewedAs`: 作成時の比較対象 `{ from, to }`（記録用）
  - `status`: `open` / `replied` / `resolved` / `outdated`
  - `thread`: `{ author: "user" | "agent", body, at, agentSession?, draft }[]`
- F5-2. アンカーは行番号ではなく行の内容: 対象行（範囲、1 行以上）のテキスト、前後 3 行のコンテキスト、新側 / 旧側、正規化ハッシュ。表示時に現在の diff へコンテキスト一致で再計算する。
- F5-3. 状態遷移: `open` →（agent 返信）→ `replied` →（user 解決）→ `resolved`。**resolve は user のみ**。user が返信すると `replied` → `open`。`outdated` からは user の再アンカー成功で `open` に戻せる。user のメッセージ（新規レビュー・返信とも）はまず下書きとして作られ、Web UI の送信操作でまとめて `open` になる（F5-6）。
- F5-4. 再アンカー: `repo-changed` を受けたら、`target.kind == "worktree"` かつ `outdated` でないレビューについて、変更されたファイル（`git diff --name-only <prevHead> HEAD`）に限り `git blame -L` で導入 commit を探し、見つかれば `target` を commit に移す。
- F5-5. `outdated` は **worktree 付きのレビューにだけ** 適用する。commit 付きのレビューは commit の diff で常に表示できるので、行の再一致に失敗しても `outdated` にしない。commit が HEAD から到達不能になった場合は内容一致で新 commit を探し、見つからなければ `outdated`。
- F5-6. user のメッセージは下書きのまま agent に見えず、通知もされない。Web UI の送信操作で、対象 worktree の下書きを一括で送信済みにし、§6.5 の規則で通知先 pane を解決して `agent.prompt` を即時に 1 回（件数入り）送る。`agent_blocked` / 該当 pane 無しなら未通知として表示し「再送」を出す。文言は設定で変更可。
- F5-7. 保存先は SQLite `~/.config/herdr-web/herdr-web.db`。テーブル: `repos`、`reviews`、`review_entries`（`draft` 列を含む）。drizzle でマイグレーション。
- F5-8. git graph はコミットごとのレビュー件数（未解決・下書き）をバッジ表示する（一覧ビューは持たない）。クリックで該当 diff（作業ツリーまたは該当 commit）を開く。
- F5-9. 作成・返信・解決・再アンカーはイベント WS で反映する。

### F6. `hw` CLI（エージェント向け）

- F6-1. 同リポジトリの Bun スクリプト。`bun build --compile` で単一バイナリ化。Hono RPC クライアントを使う。
- F6-2. 呼び出し元の worktree の解決順: `--worktree <path>` → `$HERDR_PANE_ID` から `pane.get` の `foreground_cwd` → `process.cwd()`。いずれも `git rev-parse --show-toplevel` でルートに正規化。
- F6-3. サブコマンド:
  ```
  hw review list [--all] [--commit <rev>] [--since <rev>] [--uncommitted] [--unreachable] [--json]
  hw review show <id> [--json]   # <id> は `list` の出す短縮 id（末尾一致、4 文字以上）でよい
  hw review reply <id> <text>
  hw status
  hw repo move <old-path> <new-path>
  ```
  `resolve` は提供しない。
- F6-4. 宛先は `HW_URL`（既定 `http://127.0.0.1:8080`）。
- F6-5. 非対話・即終了。人間向け既定出力と `--json`。

### F7. リポジトリ登録とディレクトリ移動

- F7-1. `repos` テーブル: `key`（`git-common-dir` 絶対パス、主キー）、`rootCommit`（`git rev-list --max-parents=0 HEAD` の最古の 1 件、補助）、`name`、`firstSeenAt`、`lastSeenAt`。
- F7-2. ツール領域が未知のリポジトリを開いたら自動登録する。
- F7-3. `hw repo move <old> <new>` は `repos.key`、`reviews.repo`、`reviews.worktree_root`、`reviews.target` 内の worktree root を前方一致で書き換える。自動では行わない。
- F7-4. 未知のパスで、登録済みリポジトリと同じ `rootCommit` を持つものが開かれたら、Web UI と `hw status` に「`hw repo move` で引き継げる」と提示する。

### F8. サイドバー

- F8-1. §6.6 のツリーを `repository > worktree > pane` で表示する。
- F8-2. pane 行には agent 名、状態、`label` または `terminal_title_stripped`、所属 workspace / tab を表示する。状態は色とアイコン。
- F8-3. pane 行クリックで `pane.focus`（必要なら `workspace.focus` を先に。§12-9）。
- F8-4. `blocked` / `done` 件数バッジ。
- F8-5. グループ折りたたみ、表示モード切替、フォーカスのハイライト。
- F8-6. herdr イベントでリアルタイム更新。未接続時は「herdr 未接続」。
- F8-7. サイドバーは折りたたみ可能で幅はドラッグで変更できる。
- F8-8. リポジトリ見出しに「ワークスペースを作成」ボタンを出す。開くインラインフォームの label 初期値はリポジトリ名、cwd はそのリポジトリの main worktree root。`workspace.create({ cwd, label, focus: true })` を呼ぶ（`POST /api/herdr/workspace`、cwd は git ルートと同じ allowed-roots 検査を通す）。
- F8-9. workspace 行を右クリックすると「名前を変更」「削除」を持つカスタムコンテキストメニューを出す（キーボードの Shift+F10 / コンテキストメニューキーでも開ける）。「名前を変更」は現在の label を初期値にしたダイアログから `workspace.rename`、「削除」は pane / agent がすべて終了する旨を明示した確認ダイアログから `workspace.close`（`confirm: true` 必須）を呼ぶ。

### F9. ファイルビューア

- F9-1. ヘッダーの「編集」トグルで `CodeFileView` を編集可能にし、「保存」ボタンまたは `Cmd+S`/`Ctrl+S` で `PUT /api/fs/file` により明示保存する（自動保存はしない）。既存ファイルの上書き保存のみ受け付ける（新規作成はしない）。`baseHash`（`GET /api/fs/file` の `hash`、diff 側と同じ git blob hash）が保存直前のディスク上の内容と一致しない場合は 409、`.git` 配下 / symlink / 非 UTF-8（`GET` の `editable`/`readOnlyReason` と同じ判定）は 422 で拒否する。下書きはタブ・worktree ごとに保持し、ディスク上の変更を検出した／409 になった場合はバナーで「上書き保存」「破棄して再読込」を選べる。Markdown/HTML はソース表示中だけ編集できる。
- F9-2. ツリーは git を経由しない素の `readdir`（`GET /api/fs/ls?root=&dir=`）で、ディレクトリが展開されたときにその 1 階層分だけを遅延取得する。ドットファイルや `.git` も含め `ls -a` が見せるものはすべて列挙し、上限は無い。シンボリックリンクは種別 `symlink` として表示するだけで辿らない。ツリー描画は `@pierre/trees`。
- F9-3. `git status --porcelain` 由来の変更状態（追加・変更・削除・リネーム・未追跡）を `GET /api/git/status?repo=` から取得し、ツリーの行装飾としてのみ表示する（一覧そのものには影響しない）。
- F9-4. ファイルを選択すると単一ファイルの内容を表示する。`.md` / `.markdown` は `@wysimark/react` でプレビューする（編集機能を持つエディタを選んだのは、将来 F9-1 を解除して保存に対応する計画があるため。v3 に `readOnly` プロパティが無いため、DOM 上で `contenteditable` を無効化して読み取り専用にする）。それ以外は `@pierre/diffs` の `File` でシンタックスハイライト表示する。画像 / PDF は `GET /api/fs/raw` の生バイトを `<img>` / `<iframe>` で直接プレビューする。
- F9-5. バイナリファイルとサイズ上限（2 MiB）超のファイルは内容を取得せず、種別とサイズだけを表示する。
- F9-6. `repo-changed` イベント（F3-4 のポーリングを含む）でツリーと選択中ファイルを再取得する。サブリポジトリ選択中は F3-4 と同じポーリングにフォールバックする。
- F9-7. ツリーへのファイル/フォルダのドラッグ&ドロップでインポートできる（`POST /api/fs/upload`）。ドロップされたファイル群はドロップ先ディレクトリ配下にそのパス構造のまま書き込まれる。既存パスと衝突する場合は書き込まず、上書きの確認を経てから `overwrite=true` で再送する。これは git 操作ではなく素の書き込み（`fs.writeFile` 相当）であり、Web UI が行うファイルシステム書き込みは import と trash（F9-9）のみである。削除は常に OS のゴミ箱への移動（`trash` / Finder / `gio trash`）であり、`rm` は使わない。書き込み後の反映は F9-6 の `repo-changed` / ポーリングに乗る。
- F9-8. フォントサイズ・ツリー表示 on/off・ツリー幅は F3（diff ビューア）と共有する設定（`herdr-web:viewer-settings`）。エディタの見た目を揃えるため、既定フォントサイズは F3 の 15px ではなく F9 側の 13px を両者の既定値とする。
- F9-9. ツリーの行を右クリックすると「相対パスをコピー」「絶対パスをコピー」「ゴミ箱に移動」の 3 項目を持つメニューを出す。「ファイル自体をコピー」は提供しない（ブラウザはファイルを OS クリップボードに乗せられない）。「ゴミ箱に移動」は確認ダイアログ（ディレクトリの場合は中身ごと移動する旨を明示）を経てから `POST /api/fs/trash` を呼ぶ。成功するとヘッダーに一時メッセージを出し、ツリーを再取得し、選択中のファイルが移動対象かその配下だった場合は選択を解除する。バックエンドが無い環境（501）では「この環境ではゴミ箱に移動できません」と表示する。

### F10. 質問（コード箇所への会話）

- F10-1. 「質問」(ask) はコードベースの場所（`path` + レビューと同じ内容アンカー、`side` は常に `"new"`）に付く会話で、変更依頼ではない。レビュー（F5）とは別テーブル・別 API を持ち、下書き・一括送信・コミットへの追従は無い。作成 = 即送信。
- F10-2. 状態遷移は `open` →（エージェント返信）→ `replied` →（ユーザー解決）→ `resolved`。`replied` へのユーザー返信は `open` に戻す。解決はユーザーのみでき、同時にエージェントセッションを閉じる。
- F10-3. アンカーが worktree の現在のファイル内容に一致しなくなったら（Files タブで都度判定）、未解決の質問は `outdated` になる。再び一致すれば `open` に戻る。コミットへの再アンカーは行わない。
- F10-4. 回答するエージェントは「専用 herdr ワークスペース（`target.kind: "new"`、label は `ask:<id 末尾 8 文字>`、サーバーが worktree で claude を起動し初回プロンプトを送る）」か「既存のエージェント pane（`target.kind: "pane"`）」のいずれかで動く。専用ワークスペースの起動・プロンプト送受信は `AskSessionLauncher` ポート（`src/server/ask/ports.ts`）の背後に隠す。セッション状態（`working`/`blocked`/...）はユーザーにのみ見え、herdr で開く操作を提供する。
- F10-5. 専用ワークスペースの起動に失敗したら（herdr 未接続 / 上限到達 / その他失敗）質問自体を保存しない。既存 pane 宛ての質問は、プロンプト送信が失敗しても（`agent_blocked` など）保存する — ユーザーが「再送」できる。
- F10-6. `hw ask list` / `hw ask show <id>` / `hw ask reply <id> <text>` を提供する。`reply` は常に author=agent。短縮 id（末尾 4 文字以上）による解決はレビューと同じ規則。

### F11. Docker タブ

- F11-1. 表示中の worktree（サブリポジトリ選択中はその root。以下「root」）に紐づくコンテナの一覧を、Diff / Graph / Files と並ぶタブで表示する。閲覧のみで、起動・停止・削除は持たない（§15）。ログの閲覧は F11-9。
- F11-2. コンテナと root の対応は Docker 自身が持たないため、ラベルから推定する。`com.docker.compose.project.working_dir`（docker compose）または `devcontainer.local_folder`（devcontainer）が root と一致するか root 配下（`sep` 区切りの子孫）にあるものを対象とする。compose ファイルがサブディレクトリにある場合 working_dir もサブディレクトリになるため、完全一致ではなく前方一致にする。どちらのラベルも持たないコンテナ（素の `docker run`、bind mount のみ）は対象外で、一覧には出さない（§15）。
- F11-3. `docker ps -a` 相当で running 以外（exited / created / paused など）も取得し、表示する。ポートを塞いでいる停止し損ねたコンテナを見つけるため。running を上に、次に状態、名前の順で並べる。
- F11-4. compose プロジェクト（`com.docker.compose.project`）ごとにグループ化し、各行に service 名、コンテナ名、状態と状態文字列（`Up 3 hours` 等）、image、公開ポート（host → container）、作成からの経過時間を表示する。devcontainer は `local_folder` の basename をグループ名にする。
- F11-5. 取得は `GET /api/docker/containers?root=` で、サーバーが `docker ps -a --format` を 1 回実行して全コンテナを取り、F11-2 の判定をサーバー側で行う（docker の `--filter label=` は前方一致できないため使わない）。`--format '{{json .}}'` は使わない — `Labels` フィールドが `k=v,k=v` 文字列で、値にカンマを含むラベル（`config_files` の複数ファイルなど）があると分割できないため、必要なフィールドとラベルだけをタブ区切りで明示的に指定する。`docker inspect` は使わない。root は `isAllowedRoot` で検査する。
- F11-6. 更新はタブ表示中のみの 5 秒間隔ポーリング（`refetchInterval`）。git の `repo-changed` とは無関係なので使わず、F3-4 のサブリポジトリ用 `pollMs` とも分ける。非表示タブはアンマウントされるためポーリングは止まる（既存の Tabs の挙動に乗る）。タブ見出しに件数バッジは付けない（非表示時のポーリングが必要になるため）。`docker events` は使わない。
- F11-7. 失敗は 3 種類を区別して表示する。(a) `docker` コマンドが無い（`ENOENT`、501）→「docker が見つかりません」。(b) daemon に繋がらない（非ゼロ終了。`Cannot connect to the Docker daemon` 等の stderr を添える、503）→「Docker daemon に接続できません」。(c) 該当コンテナが 0 件（200、空配列）→「この worktree に紐づくコンテナはありません（compose / devcontainer のラベルで判定）」。daemon が固まると `docker ps` が返らないことがあるため 5 秒でタイムアウトし（504）、前回取得した一覧を残したままヘッダーにエラーを出す。
- F11-8. サーバーは `docker ps` の結果を 2 秒キャッシュし、同時要求は 1 本にまとめる（複数ブラウザで走査が増えないように）。

- F11-9. 行をクリックすると、その行の下にログ領域を展開し、`docker logs --follow --tail 200 --timestamps <id>` の出力をストリーミング表示する。ポーリングではなく WebSocket `/ws/docker-logs?root=&id=&tail=`（§9.y）で、サーバーは接続ごとに `docker logs` を 1 プロセス起動し、stdout / stderr を到着順にテキストフレームで送り、ソケットが閉じたら子プロセスを kill する（展開を閉じる・タブを離れる・worktree が切り替わる・ブラウザを閉じる、のいずれでも止まる）。サーバーは接続時に `id` が root に紐づくコンテナ（F11-2 の判定）であることを確認し、違えば 403 相当のメッセージを送って閉じる（root 検査だけでは任意コンテナのログが読めてしまうため）。`docker logs` が終了したら（コンテナ停止など）終了コードを添えた終了フレームを送って閉じる。クライアントは末尾 2000 行だけ保持し、最下部にいるときだけ自動スクロールする（上にスクロールしたら追従を止め、「最新へ」ボタンで戻る）。展開できるのは同時に 1 コンテナ。

### F12. Process タブ

- F12-1. root 配下を cwd とするプロセスの一覧を、Docker タブと並ぶタブで表示する。閲覧のみで、kill / シグナル送信は持たない（§15）。
- F12-2. 「その worktree のプロセス」は cwd 基準で決める。全プロセスの cwd を取り、root と一致するか root 配下のものを対象とする。herdr の pane から起動されたかどうかは問わない（nohup や別ターミナルからの起動も拾うため。pane 起点の判定は `pane.process_info` が必要で、取りこぼしが増える）。既知の取りこぼしは、起動後に cwd を root 外へ移したプロセスと、cwd は root 外だが root のファイルを触っているプロセス。
- F12-3. 対象プロセス同士の親子関係（ppid）でツリー表示する。親が対象外のプロセスはツリーのルートになる。pane の shell → claude → `bun dev` のような階層がそのまま見える。herdr-web 自身や走査用の一時プロセスは特別扱いしない。
- F12-4. 各行に PID、コマンド（argv0 の basename + 引数を 1 行に短縮、ホバーで全文）、CPU%、RSS、経過時間、LISTEN 中の TCP ポートを表示する。ポートは主目的（「この dev server は何番で待っているか」）であり、行の先頭側に置く。
- F12-5. 取得は `GET /api/proc/list?root=` で、サーバーが `ps -axo pid,ppid,pcpu,rss,etime,command` と `lsof -n -d cwd -Fpn`（cwd）と `lsof -nP -iTCP -sTCP:LISTEN -Fpn`（ポート）を 1 セット実行し、PID で結合して F12-2 の判定をサーバー側で行う。macOS と Linux で同じコマンドを使う。root は `isAllowedRoot` で検査する。
- F12-6. 更新はタブ表示中のみの 3 秒間隔ポーリング。F11-6 と同じ理由で `repo-changed` とバッジは使わない。サーバーは走査結果を 2 秒キャッシュし同時要求を 1 本にまとめる（走査は約 0.3 秒 / 1000 プロセス）。
- F12-7. 失敗は次を区別する。`lsof` が無い（501）→「lsof が見つかりません」。`ps` / `lsof` の非ゼロ終了（503）→ stderr を添えて表示。タイムアウト 5 秒（504）→ 前回値を残してヘッダーにエラー。対象 0 件（200）→「この worktree を cwd とするプロセスはありません」。他ユーザーのプロセスは cwd を読めないため一覧に出ない（仕様として表示文言に含めない、README に書く）。

### F13. 判断依頼（エージェントから人間への質問）

- F13-1. 「判断依頼」(decision) は、エージェントが `hw decision request` で人間に判断を求めるもの。Claude Code の AskUserQuestion の置き換えで、方向が逆の「質問」(ask, F10) とは別テーブル・別 API・別語。1 依頼は 1 件以上の設問（item）を持つ。
- F13-2. 非ブロッキングのみ。`hw decision request` は依頼を登録して即座に `{ id, url }` を返し、同期的に回答を待つコマンドは提供しない。回答・却下・取り下げの結果は、サーバーが呼び出し元 pane へ `agent.prompt` で届ける。推奨する使い方（スキルに書く）は「依頼を出したらターンを終えて待つ。結果は次のユーザー発言として届く」。エージェントは herdr 上で idle になるので、人間からも待っていることが分かる。
- F13-3. 呼び出し元は `hw` が環境変数から自動収集する: `HERDR_PANE_ID`（herdr が pane の子プロセスに渡す）、`CLAUDE_CODE_SESSION_ID`（Claude Code が Bash ツールの子プロセスに渡す。表示用）。worktree と agent 名は `/api/hw/whoami` で解決する。`--pane <id>` で上書きできる。`--pane`/`HERDR_PANE_ID` のどちらも無い、または pane が herdr 上で見つからない場合は作成レスポンスに `paneResolved: false` を含め、CLI は stderr に「回答は自動で届かない」旨を警告する（stdout の JSON はそのまま出す）。
- F13-4. status は「結果」だけを表す `open` →（人間が回答）→ `answered` / `dismissed`（却下）、エージェントが `hw decision cancel` で `cancelled`。却下は open からのみ可能。配達の状況は status と独立に `delivery: null | { state: "pending" | "sent" | "agent_blocked" | "gone" | "unknown", attempts, at, pane }` として持つ — 却下・キャンセルされた依頼も配達の成否とは無関係に `dismissed`/`cancelled` のまま残る（`hw decision list --status dismissed` で引ける）。期限と既定回答は持たない。回答が無い限り依頼は open のまま残り、エージェントが勝手に進むことはない。
- F13-5. 依頼の書式（`hw decision request --file d.json` / stdin、`hw decision schema` が JSON Schema を出す）: `title?`、`context?: Block[]`、`items: { id, header, question(markdown), kind: single | multi | text | confirm, options?: { label, description?, recommended?, preview?: Block[] }[], allowOther?(既定 true), required?(既定 true) }[]`、`layout?: "compare"`（選択肢の preview を横並びで比較）。設問数・選択肢数の上限は設けない。JSON は 1 MiB まで。valibot スキーマを CLI（事前検証。エラーは JSON パスと理由を stderr）・サーバー・UI で共用する。
- F13-6. Block の種別と描画: `markdown`（既存の Markdown ビューア）、`code { language, text }`（`@pierre/diffs` の `File`）、`diff`（unified patch を `@pierre/diffs`）、`mermaid`（`mermaid` を動的 import、`securityLevel: "strict"`）、`svg`（`<img src="data:image/svg+xml">` でスクリプトを無効化）、`html`（`sandbox` 付き iframe の `srcdoc`。`allow-same-origin` は付けない。`allowScripts: true` のときだけ `allow-scripts`）、`image { path }`（`/api/fs/raw`、allowed roots 配下のみ）、`location { path, lines? }`（Files タブでその場所を開く。ask のアンカーと同じ）、`table { header[], rows[][] }`。
- F13-7. 回答は設問ごとに `{ selected: string[], other: string | null, note: string | null }`（`text` は `other` に入る、`confirm` は `selected` が `["yes"]` / `["no"]`）。回答への場所添付は持たない。`agent.prompt` の本文は「判断依頼 <短縮 id>（<title>）に回答: <item>=<選択>（note: ...）。全文は `hw decision show <id>`」の形で 2 KiB 以内に収め、超える分は show に逃がす。
- F13-8. UI: サイドバー上部に全 worktree の open 件数バッジを出し、クリックでツール領域に全 worktree 横断の一覧（open が上、フィルタは open/answered/dismissed/cancelled/all、各行にエージェント名・worktree・経過時間・状態）を出す。行クリックでツール領域を占有する依頼ビュー（`context` → 設問 → 回答フォーム → 送信 / 却下）に切り替わる。focus が別 worktree に動いても表示中の依頼は閉じない。キーボードは 1〜9 で選択、Enter（busy 中は無効）で送信、Esc で閉じる。非 open な依頼を開くと確定した回答（選択・その他・メモ・confirm の yes/no）を読み取り専用で表示する。配達状況（`delivery.state` と試行回数）を表示し、status が answered/dismissed かつ `delivery.state` が `sent` 以外（未着手の null を含む）のとき「再送」を出す。依頼にはエージェント名・pane・worktree・Claude セッション id・経過時間を表示し、「pane を開く」で F8-3 と同じく focus を移せる。入力途中の回答は `localStorage`（`herdr-web:decision-draft:<id>`）に持ち、ブラウザのリロードをまたいで残る — 送信・却下・取り下げ・依頼の非 open 化で消す。
- F13-9. 配達は review 通知（F5）の notifier / scheduler と同じ発想（`agent.prompt` 送信、`sendAgentPrompt` を共用）で組む。herdr 切断中、または snapshot 未取得の間（`HerdrStateStore.isSettled()` が false の間）は pane の有無を判定できないため `gone` と誤判定せず、`delivery.state = "pending"` のまま指数バックオフ（上限 60 秒）で無期限に再試行する。`agent_blocked`（herdr には届いたが pane がブロック中）は自動再試行せず、人間の「再送」でのみ再送できる。起動時は `drainPending` で `delivery.state !== "sent"` な依頼を拾い直す。
- F13-10. Claude Code 側の導線は README に雛形を置く: `.claude/skills/hw-decision/SKILL.md`（AskUserQuestion の代わりに `hw decision request` を使う、出したらターンを終える、書式は `hw decision schema`）と、AskUserQuestion を PreToolUse hook で deny し理由文で `hw decision request` へ誘導する settings.json の例。`hw` がユーザーの設定ファイルを書き換えることはしない。
- F13-11. 依頼作成時、herdr が接続していればサーバーが `notification.show`（`{ title, body?, sound? }`）でデスクトップ通知を出す。`title` は「判断依頼: <依頼の title または最初の設問の header>」、`body` は「<agent> / <worktree の basename>。Web UI で回答してください」。失敗しても依頼の作成自体は成功させ、ログにのみ残す。

### F14. ツール領域のルーティング（URL が画面状態の正）

- F14-1. ツール領域（右側 aside）の中身はルーターが決める。シェル（サイドバー / ターミナル / aside の 3 カラム、幅と折りたたみ）はルートの外に置き、ターミナルはルート遷移で再マウントされない。ルーターは TanStack Router（`@tanstack/react-router`）、履歴はブラウザ履歴（hash ではない）。サーバーは未知のパスに index.html を返す（`serveEmbedded` は対応済み、dev は Vite の SPA フォールバック）。search params は valibot で検証し、不正値は既定値に丸める。
- F14-2. ルート構成:
  - `/` → `/focus/diff` へリダイレクト。
  - `/focus/<tab>` … herdr の focus に追従して worktree を決める（今の既定動作）。
  - `<tab>` は `diff | graph | files | docker | process`。
  - `/decisions` と `/decisions/<id>` … 判断依頼の一覧とビュー。`/focus` と兄弟なので、開いても ToolPane はアンマウントされない（別ルートのマッチとして描画が切り替わるだけで、戻ったときにタブ・比較範囲・選択ファイルは URL から復元される）。
- F14-3. search params（タブごと）:
  - diff: `from`, `to`（比較範囲。無ければ WORKTREE vs HEAD）、`sub`（サブリポジトリ id）、`path`, `line`（ジャンプ先。`initialLocation` の置き換え）。
  - graph: `sub`。
  - files: `sub`, `path`（選択ファイル）, `line`（選択行）, `md`（`source | preview`）。
  - docker / process: `sub`。
  - サブリポジトリ切替と worktree 切替で消えるべき params（`from` / `to` / `path` / `line`）はナビゲーション時に落とす。
  - タブ切替では `path` / `line` を落とす（タブごとに意味が異なるため）。`from` / `to` / `sub` は残す。
- F14-4. 既存 state の移し先: App の `decisionUi`、ToolPane の `activeTab` / `comparison` / `subRepoId` / `initialLocation`、FilesPanel の `selectedPath` / `mdMode`、App の `filesInitialLocation`（ask の「対象ファイルを開く」と decision の `location` Block は、対象 worktree が focus と違えばその worktree の pane へ `focus-pane` を送って herdr 側のフォーカスを移してから `/focus/files?path=&line=` へ navigate する。その worktree に pane が無ければ開けない旨を表示する）。これらの `useState` と「消費したら null に戻す」契約はすべて削除する。ローカルに残すのは一時的な UI 状態（ドラッグ幅、送信中フラグ、ダイアログ開閉、コピー済み表示）だけ。
- F14-5. herdrStore は React Context（`HerdrStoreProvider` / `useHerdrState()` / `useHerdrStore()`）で配り、WS イベントの購読は `useReviewEvents(cb)` / `useAskEvents(cb)` / `useDecisionEvents(cb)` のフックにする。`subscribeXxxEvents` を props で渡す経路はすべて消す。
- F14-6. サーバーが返す判断依頼の URL（`hw decision request` の `url`、§9.w）は `http://<host>:<port>/decisions/<id>` にする。`#decision/<id>` は受け付けない（移行期間は設けない。未コミットの依頼 URL は存在しないため）。
- F14-7. 動作は変えない。既存のテスト（App / ToolPane / 各 Panel）は、props で渡していた state を URL とルーターのテスト用ユーティリティ（メモリ履歴）に置き換えて通す。ブラウザの戻る / 進むでタブと判断依頼ビューが切り替わること、リロードで同じ画面に戻ること、判断依頼ビューから戻っても比較範囲が残ることを振る舞いテストにする。

## 8. 非機能要件

- N1. `127.0.0.1` に固定。`tailscale serve --bg 8080` で公開する手順を README に書く。`--host` は緊急用で非 loopback なら警告。
- N2. ブラウザから到達できる者は実行ユーザーと同じ権限を持つことを README に明記。認証は持たない。
- N2a. WS の接続先は `location.host` / `location.protocol` から組み立てる。Host ヘッダ検査は `tailscale serve` のホスト名も許可できるよう設定可にする。
- N3. `bun run dev` で開発起動、`bun run build` で単一バイナリ。
- N4. herdr 未接続でも Web UI 全体は落ちない。ソケットは指数バックオフで再試行し、再接続時に `session.snapshot` を取り直す。
- N5. git は読み取り専用コマンドのみ。パスは git ルート配下に正規化。引数配列で渡す。`LC_ALL=C`。
- N6. `ping` でプロトコルバージョンを確認し、未知フィールドは無視する。
- N7. 依存は最小限。
- N8. 設定は `~/.config/herdr-web/config.json`（`--config` で上書き）。valibot で検証し、不正なら起動時に理由を出して既定値で続行する。

## 9. API / プロトコル仕様

### 9.1 WebSocket `/ws/term`

- クエリ: `?session=<name>`
- クライアント → サーバー: バイナリフレーム = 入力、テキストフレーム = `{ "type": "resize", "cols", "rows" }`
- サーバー → クライアント: バイナリフレーム = 出力、テキストフレーム = `{ "type": "exit", "code" }`

### 9.2 WebSocket `/ws/events`

- サーバー → クライアント
  - `{ type: "tree", repos: Repo[] }`
  - `{ type: "pane-updated", row: PaneRow, worktreeRoot, repoKey }`
  - `{ type: "pane-removed", pane }`
  - `{ type: "focus", pane, workspace, cwd, foregroundCwd, worktreeRoot, repoKey, agent, agentStatus, agentSession }`
  - `{ type: "repo-changed", worktreeRoot, hash }`
  - `{ type: "review", event: "created"|"replied"|"resolved"|"reanchored"|"outdated", review }`
  - `{ type: "review-notify", reviewId, result: "sent"|"agent_blocked"|"no_target", pane }`
  - `{ type: "herdr", connected, protocol }`
- クライアント → サーバー
  - `{ type: "focus-pane", pane }`

### 9.3 Hono RPC — git（`repo` = worktree ルート）

| メソッド | パス                                                       | 説明                                                                                                                                                                    |
| -------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/api/health`                                              | 稼働確認、herdr 接続状態                                                                                                                                                |
| GET      | `/api/git/root?path=`                                      | 任意パスから worktree ルートとリポジトリキーを解決                                                                                                                      |
| GET      | `/api/git/patch?repo=&from=&to=`                           | tdiff 形式: `{ patch, hash, files: {name, hash, oldHash, newHash, untracked}[], untrackedCount, untrackedTruncated }`。`from`/`to` は `WORKTREE` / `INDEX` / commit-ish |
| GET      | `/api/git/files?repo=&path=&prev=&type=&oldHash=&newHash=` | hunk 展開用の全文（tdiff の `resolveFiles`）                                                                                                                            |
| GET      | `/api/git/graph?repo=&max=&all=`                           | tgg 形式: `{ commits, refs, head, stashes, hasUncommitted, truncated }`                                                                                                 |
| GET      | `/api/git/commit/:hash?repo=`                              | tgg 形式: メタ + `files: CommitFile[]`                                                                                                                                  |
| GET      | `/api/git/status?repo=`                                    | ファイルビューアの行装飾用 worktree 状態（F9-3）: `{ status: TreeStatusEntry[] }`                                                                                       |

### 9.4 Hono RPC — fs（`root` = 任意のディレクトリルート、git 操作ではない素のファイルシステム操作）

| メソッド | パス                                   | 説明                                                                                                                                                                                             |
| -------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET      | `/api/fs/ls?root=&dir=`                | ファイルビューアの 1 ディレクトリの `readdir`（F9-2）: `{ entries: {name, kind}[] }`                                                                                                             |
| GET      | `/api/fs/file?root=&path=`             | ファイルビューアの単一ファイル（F9-4/F9-5）: `{ kind: "text", contents, size } \| { kind: "binary", size } \| { kind: "too-large", size }`                                                       |
| GET      | `/api/fs/raw?root=&path=`              | ファイルビューアの画像/PDF プレビュー（F9-4）: 対応拡張子の生バイトをそのまま返す。非対応拡張子は 415、50 MiB 超は 413                                                                           |
| POST     | `/api/fs/upload?root=&dir=&overwrite=` | ツリーへの DnD インポート（F9-7）、`multipart/form-data` の `file` パート群（ファイル名は `dir` からの相対パス）: `{ written: string[] }`。既存パスと衝突すると 409 `{ error: "exists", paths }` |
| POST     | `/api/fs/trash?root=&path=`            | ツリーの右クリックメニューからの OS ゴミ箱移動（F9-9）: `{ trashed: path }`。`.git` 自身/配下と空文字は 400 `forbidden-path`/`invalid-path`、バックエンド無しは 501 `no-trash-backend`           |

### 9.5 Hono RPC — review（Web UI と `hw` が共用）

| メソッド | パス                                                                                 | 説明                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/api/review?repo=&worktree=&status=&commit=&since=&uncommitted=&unreachable=&path=` | 一覧。`worktree` を渡すと §6.5 の可視性で絞る。`hw` からは下書きを含めない。`drafts=true` で Web UI 向けに下書きも返す                                               |
| GET      | `/api/review/counts?repo=&worktree=`                                                 | git graph のバッジ・送信ボタン用の集計（commit ごと / worktree の未解決・下書き件数）                                                                                |
| GET      | `/api/review/:id`                                                                    | 1 件（スレッド、アンカーのコンテキスト、現在の解決位置）。`:id` は完全な id か 4 文字以上の末尾一致（UUIDv7 の先頭はタイムスタンプで揃うため）。複数件に当たると 409 |
| GET      | `/api/review/for-diff?repo=&from=&to=&path=`                                         | 指定 diff にアンカー一致するレビューと行位置（範囲）。下書きを含む（Web UI 専用）                                                                                    |
| POST     | `/api/review`                                                                        | 下書きとして作成 `{ repo, worktreeRoot, target, path, anchor, viewedAs, body }`。通知はしない                                                                        |
| POST     | `/api/review/:id/reply`                                                              | `{ body, author, agentSession? }`。user は下書き追加、agent は送信済みとして即時追加                                                                                 |
| PUT      | `/api/review/:id/draft/:seq`                                                         | `{ body }` で下書きエントリの本文を差し替える                                                                                                                        |
| DELETE   | `/api/review/:id/draft/:seq`                                                         | 下書きエントリを削除。スレッドが空になったらレビューごと削除する                                                                                                     |
| POST     | `/api/review/send`                                                                   | `{ repo, worktreeRoot }` — 対象の下書きを一括送信し、1 回だけ通知する                                                                                                |
| POST     | `/api/review/:id/resolve`                                                            | user のみ                                                                                                                                                            |
| POST     | `/api/review/:id/reanchor`                                                           | 手動再アンカー                                                                                                                                                       |
| POST     | `/api/review/:id/notify`                                                             | 再送                                                                                                                                                                 |
| GET      | `/api/hw/whoami?pane=`                                                               | pane から `foreground_cwd`、worktree、`agent_session` を解決                                                                                                         |
| POST     | `/api/repo/move`                                                                     | `{ from, to }`                                                                                                                                                       |

### 9.x Hono RPC — ask（Web UI と `hw` が共用、F10）

| メソッド | パス                                     | 説明                                                                                                                                                         |
| -------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET      | `/api/ask?repo=&worktree=&status=&path=` | 一覧。`status` は comma-separated。既定は `open,replied`                                                                                                     |
| GET      | `/api/ask/counts?repo=&worktree=`        | Files タブのバッジ用の集計（未解決件数、path ごとの件数）                                                                                                    |
| GET      | `/api/ask/:id`                           | 1 件 + 現在のセッション状態（`sessionStatus`）。`:id` は完全な id か 4 文字以上の末尾一致。複数件に当たると 409                                              |
| POST     | `/api/ask/for-file`                      | `{ repo, worktreeRoot, path, lines }` → 現在の行内容に対するアンカー一致（Files タブ用、`outdated`/`open` 遷移もここで持続化する）                           |
| POST     | `/api/ask`                               | `{ repo, worktreeRoot, path, anchor, createdAtHead, body, target }` で作成し即送信。失敗時は保存せず 409（`limit_reached`）/ 503（`herdr_unavailable`）/ 500 |
| POST     | `/api/ask/:id/reply`                     | `{ body, author, agentSession? }`。user は `open` に戻し返信テンプレートを送信、agent は `replied`（resolved なら維持）で送信なし                            |
| POST     | `/api/ask/:id/resolve`                   | user のみ。`resolved` にしてセッションを閉じる                                                                                                               |
| POST     | `/api/ask/:id/resend`                    | 直近のユーザー発言を再送する（`agent_blocked` からの「再送」ボタン用）                                                                                       |
| POST     | `/api/ask/:id/focus`                     | herdr でセッションを開く（`pane.focus` / 必要なら `workspace.focus` を先に）                                                                                 |

### 9.y Hono RPC — docker（`root` = worktree ルートまたはサブリポジトリ root、F11）

| メソッド | パス                           | 説明                                                                                                                                                                                                                                                                             |
| -------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/api/docker/containers?root=` | root に紐づくコンテナ（F11-2）: `{ groups: { kind: "compose" \| "devcontainer", name, workingDir, containers: { id, name, service, state, status, image, ports: { host, container, proto }[], createdAt }[] }[] }`。501 = docker 無し、503 = daemon 接続不可、504 = タイムアウト |

#### WebSocket `/ws/docker-logs`（F11-9）

- クエリ: `?root=&id=&tail=`（`tail` 既定 200、上限 5000）
- サーバー → クライアント（テキストフレーム、JSON）: `{ type: "line", stream: "stdout" | "stderr", text }`（`--timestamps` のタイムスタンプは `text` の先頭に含む）、`{ type: "exit", code }`、`{ type: "error", code: "forbidden" | "not-found" | "docker-unavailable" | "failed", message }`。error のあとサーバーが閉じる。
- クライアント → サーバー: なし。閉じると子プロセスを kill する。

### 9.z Hono RPC — proc（`root` = worktree ルートまたはサブリポジトリ root、F12）

| メソッド | パス                   | 説明                                                                                                                                                                                                                                |
| -------- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET      | `/api/proc/list?root=` | root を cwd とするプロセス（F12-2）: `{ processes: { pid, ppid, command, argv0, cpu, rss, elapsedSec, cwd, listen: { port, addr }[] }[] }`（フラット。ツリー化はクライアント）。501 = lsof 無し、503 = 実行失敗、504 = タイムアウト |

### 9.w Hono RPC — decision（Web UI と `hw` が共用、F13）

| メソッド | パス                                  | 説明                                                                                                       |
| -------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| POST     | `/api/decision`                       | 作成（hw）: `{ spec, paneId?, claudeSessionId? }` → `{ id, url, paneResolved }`                            |
| GET      | `/api/decision?status=&worktreeRoot=` | 一覧（UI / `hw decision list`。CLI 既定は `open` のみ、`--status all` で全件）                             |
| GET      | `/api/decision/counts`                | 全体の open 件数（サイドバー）                                                                             |
| GET      | `/api/decision/:id`                   | 詳細（`hw decision show`）                                                                                 |
| POST     | `/api/decision/:id/answer`            | 回答（UI）: `{ answers }`。spec と突き合わせて検証し（400 で拒否）、answered にして配達を試みる            |
| POST     | `/api/decision/:id/dismiss`           | 却下（UI）。dismissed にして配達を試みる                                                                   |
| POST     | `/api/decision/:id/cancel`            | 取り下げ（hw）。配達は試みない                                                                             |
| POST     | `/api/decision/:id/resend`            | 再配達（UI）。status が answered/dismissed かつ `delivery.state` が `sent` 以外のときだけ受け付ける（409） |
| GET      | `/api/decision/schema`                | spec の JSON Schema（`hw decision schema`）                                                                |

WS `/ws/events`: `{ type: "decision", action: "created" | "answered" | "dismissed" | "cancelled" | "delivered" | "delivery-updated", id, worktreeRoot, paneId }`。`delivered` は配達成功（`delivery.state = "sent"`）、`delivery-updated` はそれ以外の配達状態の変化（pending/agent_blocked/gone/unknown）。

### 9.6 herdr socket API の利用一覧

| 用途               | メソッド / イベント                                                                                |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| 接続確認           | `ping`                                                                                             |
| 初期状態           | `session.snapshot`                                                                                 |
| 購読               | `events.subscribe`                                                                                 |
| pane 情報          | `pane.get`                                                                                         |
| フォーカス         | `pane.focus`（必要なら `workspace.focus`）                                                         |
| 通知               | `agent.prompt`                                                                                     |
| トースト通知       | `notification.show`（判断依頼作成時、F13-11）                                                      |
| ワークスペース管理 | `workspace.create` / `workspace.rename` / `workspace.close`（サイドバー、`/api/herdr/workspace*`） |

## 10. 実装上の注意

- **bun-pty**: `bun:ffi` で Rust の dylib を読む。`bun build --compile` 時に dylib の同梱方法を M6 で確認する。
- **初回 resize**: 接続直後に送らないと初回描画が崩れる。
- **フォント**: herdr の TUI は Nerd Font を使う。xterm.js の `fontFamily` に指定する。
- **テーマ**: CSS 変数を 1 か所で定義し、shadcn、xterm の theme オブジェクト、`@pierre/diffs` の `--diffs-*` 変数へ流し込む。`@pierre/diffs` は Shadow DOM なので Tailwind は届かない。
- **git 解決のコスト**: cwd → 結果のキャッシュを持つ。
- **ブラウザのキー衝突**: `Ctrl+W` / `Ctrl+T` / `Ctrl+N` を `attachCustomKeyEventHandler` で握る。
- **herdr ソケット**: 購読用接続とリクエスト用接続を分ける。
- **CodeView の更新**: item の `id:version` が変わらないと再描画されない。内容変更は `reconcile.ts` の version、annotation（コンポーザー / レビュースレッド）の変化は `annotationVersion.ts` で version に畳み込む。
- **再アンカーのコスト**: worktree 付きかつ対象ファイルが変更された場合のみ blame。
- **drizzle**: マイグレーション SQL を `bun build --compile` に同梱し、起動時に適用する。

## 11. ディレクトリ構成

```
herdr-web/
├── package.json / bunfig.toml / tsconfig*.json / vite.config.ts
├── .oxlintrc.json / .oxfmtrc.json / .dependency-cruiser.cjs
├── drizzle.config.ts / drizzle/            # マイグレーション SQL
├── src/
│   ├── contract/                # valibot スキーマ、WS メッセージ型、キー関数、AppType の re-export
│   ├── server/
│   │   ├── main.ts              # エントリ。http.createServer + Hono + ws + Vite(dev)
│   │   ├── app.ts               # Hono ルート組み立て（AppType を export）
│   │   ├── config.ts
│   │   ├── terminal/pty.ts
│   │   ├── herdr/               # gateway.ts, socket-client.ts, fake.ts, state.ts, tree.ts, focus.ts
│   │   ├── git/                 # run.ts, patch.ts, splitPatch.ts, files.ts, log.ts, refs.ts, detail.ts, poller.ts, resolve.ts
│   │   ├── review/
│   │   │   ├── domain/          # annotation.ts, transitions.ts, anchor.ts
│   │   │   ├── ports.ts
│   │   │   ├── usecases/
│   │   │   └── adapters/        # sqlite-repository.ts, herdr-notifier.ts, git-blame.ts
│   │   ├── db/                  # schema.ts, client.ts, migrate.ts
│   │   ├── events/broadcast.ts
│   │   └── routes/              # git.ts, review.ts, hw.ts, repo.ts
│   ├── web/                     # main.tsx, components/{sidebar,terminal,tool,diff,graph,review}, lib/
│   └── cli/hw.ts
└── README.md
```

## 12. 調査・確認タスク

| #   | 項目                                                | 状態                                                                                               |
| --- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 1   | `foreground_cwd` 変化で `pane.updated` が発火するか | 未確認（3 秒ポーリングをフォールバックとして実装済み）                                             |
| 2   | schema の正確な形                                   | `herdr api schema --json` あり。valibot 手書きで対応                                               |
| 3   | `agent.prompt` の Claude Code への入り方            | 済（ブラウザでレビュー作成 → 10 秒後にこの pane へ到達 → `hw review reply` → UI に即時反映を確認） |
| 4   | PTY ライブラリ                                      | 済（node-pty は Bun で onData が来ない。bun-pty 採用、`env -i` で環境を置換）                      |
| 5   | herdr TUI の xterm.js 描画                          | 済（Chrome で TUI 描画・入力・サイドバー・diff/graph/レビューの往復を実走確認）                    |
| 6   | 移植範囲                                            | 済（§3）                                                                                           |
| 7   | `agent_session` の形                                | 済（§3）                                                                                           |
| 8   | サイドバー非表示キー                                | 済（`[ui] sidebar_collapsed_mode = "hidden"`）                                                     |
| 9   | `pane.focus` の workspace 越え                      | 未確認。`workspace.focus` → `pane.focus` の順で呼ぶ安全側で実装                                    |
| 10  | snapshot に `foreground_cwd`                        | 済（含まれる）                                                                                     |
| 11  | 他エージェントの `agent_session`                    | 未確認                                                                                             |
| 12  | `tailscale serve` 経由の WS                         | M6 で確認                                                                                          |

## 13. 運用メモ（README 向け）

### 出先からのアクセス

```bash
tailscale serve --bg 8080
```

### 壁打ち → worktree の流れ

```
herdr の workspace（メインチェックアウト）で claude を起動
  → 壁打ち → 「feat/xxx として worktree で進めて」
  → Claude が EnterWorktree、ツール領域が自動でその worktree に追従
  → 実装 → Web UI で diff を見てレビュー → Claude が hw review で対応
  → ExitWorktree
```

### レビューの運用

- 各エージェントの指示ファイルに `hw review` の使い方を書く（例: 「レビュー通知を受けたら `hw review list` で確認し、対応後 `hw review reply <id>` で返答する。解決の判断はユーザーが行う」）。
- レビューは変更に付く。同じ worktree なら別セッションのエージェントでも見える。
- エージェントが `blocked` の時は通知が届かない。「再送」で送り直す。
- resolve できるのはユーザーだけ。
- リポジトリを移動したら `hw repo move <old> <new>`。

## 14. マイルストーン

- **M0: スキャッフォルド** — Bun + Vite + React + shadcn + Hono + lint / format / depcruise / テスト基盤。`bun run dev` で空ページ。
- **M1: ターミナル attach** — PTY、WS、xterm.js、resize、再接続、キー衝突。
- **M2: herdr 状態とフォーカス追従** — gateway（socket / fake）、state、focus、`/ws/events`。
- **M2.5: サイドバー** — tree 再構成、F8。
- **M3: diff** — tdiff 移植、`/api/git/patch` `/api/git/files`、poller、`repo-changed`。
- **M4: graph** — tgg 移植、`/api/git/graph` `/api/git/commit`、選択 → diff。
- **M5: レビュー + `hw`** — sqlite、domain、usecases、通知、git graph の件数バッジ、CLI、再アンカー。
- **M6: ビルド・配布** — 単一バイナリ、設定、README。
- **M7: Docker / Process タブ** — F11、F12、`/api/docker/containers`、`/api/proc/list`、サーバー側キャッシュ、失敗 3 種の表示。
- **M8a: 判断依頼（互換成立）** — 契約 + DB + `hw decision request/show/list/cancel/schema` + サイドバーの行とバッジ + 依頼ビュー（markdown と選択肢）+ 回答 / 却下の配達と再送。
- **M8b: 判断依頼（表現力）** — Block 描画（code / diff / mermaid / svg / html / image / location / table）と compare レイアウト。
- **M8c: 判断依頼（仕上げ）** — 回答への location 添付、履歴、README のスキル / hook 雛形。
- **M9: ツール領域のルーティング** — F14。TanStack Router 導入、URL への state 移行、herdrStore の Context 化と購読フック、判断依頼 URL の変更。機能追加なし。

## 15. 将来拡張

- レビューの MCP サーバー化
- `hw open <path|commit>`
- サイドバーからの workspace / worktree 操作
- worktree 横断比較
- git の書き込み操作
- Docker タブの操作（stop / restart）と、compose / devcontainer ラベルを持たないコンテナの表示（bind mount の source で紐づける。Docker Desktop for Mac は source を `/host_mnt/...` で報告する）
- Process タブからの kill / シグナル送信、herdr pane との対応付け（`pane.process_info`）
