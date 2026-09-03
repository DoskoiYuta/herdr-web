# herdr Web UI — 設計・要件定義書

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

Web UI は herdr の状態を **読む** ことを基本とし、worktree の作成や pane の起動は行わない。Web UI から herdr への「書き込み」は、サイドバーからのフォーカス切り替え（`workspace.focus` / `pane.focus`）と、レビュー通知としての `agent.prompt` の 2 種のみ。

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
- リポジトリ単位でグルーピングしたサイドバー（workspace / worktree / pane / agent 状態、フォーカス切り替え）
- フォーカス pane の `foreground_cwd` の追跡と git ルートの解決（ピン留め可）
- 内蔵 diff ビューア（作業ツリー / ステージ / 任意コミット間）とファイルツリー（tdiff から移植するため含める）
- 内蔵 git graph（コミットグラフ、ブランチ、コミット選択 → diff 連携）
- diff へのレビュー（worktree / コミットへの紐付け、内容アンカー、スレッド、状態管理）と、エージェント向け CLI `hw`
- レビュー作成時の `agent.prompt` によるエージェント通知
- レビューの一覧ビュー
- 単一プロセス・単一コマンドでの開発起動、単一バイナリへのビルド
- `127.0.0.1` バインドのまま `tailscale serve` 経由で tailnet から利用できること

### 含まない（初期スコープ外）

- herdr 自身のサイドバーの制御
- 外部 Web アプリの iframe 埋め込み、リンク集、ブラウザ機能
- worktree の作成・削除
- herdr の内部 render socket への直接接続
- 認証・公開運用（アクセス制御は Tailscale の ACL に委ねる）
- git の書き込み操作（stage / commit / checkout / fetch / pull）
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
6. ユーザーはツール領域で追従をピン留め（一時停止）できる。

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

**通知先**: 作成時に、そのレビューの worktree（commit 付きの場合は、その commit を HEAD に含む worktree）を `foreground_cwd` に持つ pane を探し、フォーカス pane が含まれればそこへ、無ければ最初のエージェント pane へ `agent.prompt` する。無ければ「未通知」。通知先は保存せず、再送時に再解決する。

**壊れ方**

| 事象                                            | 結果                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| worktree が削除された                           | 未コミットのレビューは `outdated`。一覧ビューにだけ残る                                             |
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
- F2-3. herdr 未接続時はツール領域に「herdr 未接続」を表示し、手動でパスを入力してリポジトリを開けるフォールバックを提供する。
- F2-4. ピン留めと解除。ピン留め中も裏で追跡し、解除時に即反映する。

### F3. diff ビューア（tdiff から移植）

- F3-1. 変更ファイル一覧（未ステージ / ステージ / 未追跡、上限 200）とファイルツリー。
- F3-2. unified / side-by-side。狭幅では unified に自動切替。シンタックスハイライトは `@pierre/diffs`。
- F3-3. 比較対象: 作業ツリー vs HEAD（既定、staged + unstaged）、ステージ vs HEAD、任意の 2 commit（F4 から渡す）。
- F3-4. 変更検知は 1 秒間隔の git ポーリング（tdiff の poller）。フォーカス中の worktree だけをポーリングし、`repo-changed` を配信する。
- F3-5. バイナリは要約表示。
- F3-6. 行または行範囲を選択してレビューを付けられる（F5）。現在表示中の diff にアンカーが一致するレビューを該当行にインライン表示する。

### F4. git graph（tgg から移植）

- F4-1. DAG レーン描画、ブランチ・タグ、HEAD、未コミット変更の擬似ノード。
- F4-2. 既定で直近 N コミット（設定可）、「さらに読み込む」で倍増。
- F4-3. コミットを選ぶとそのコミットの diff を F3 に表示する。2 つ選ぶと範囲 diff。
- F4-4. 全ブランチ / 現在ブランチのみ。

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
  - `thread`: `{ author: "user" | "agent", body, at, agentSession? }[]`
- F5-2. アンカーは行番号ではなく行の内容: 対象行テキスト、前後 3 行のコンテキスト、新側 / 旧側、正規化ハッシュ。表示時に現在の diff へコンテキスト一致で再計算する。
- F5-3. 状態遷移: `open` →（agent 返信）→ `replied` →（user 解決）→ `resolved`。**resolve は user のみ**。user が返信すると `replied` → `open`。`outdated` からは user の再アンカー成功で `open` に戻せる。
- F5-4. 再アンカー: `repo-changed` を受けたら、`target.kind == "worktree"` かつ `outdated` でないレビューについて、変更されたファイル（`git diff --name-only <prevHead> HEAD`）に限り `git blame -L` で導入 commit を探し、見つかれば `target` を commit に移す。
- F5-5. `outdated` は **worktree 付きのレビューにだけ** 適用する。commit 付きのレビューは commit の diff で常に表示できるので、行の再一致に失敗しても `outdated` にしない。commit が HEAD から到達不能になった場合は内容一致で新 commit を探し、見つからなければ `outdated`。
- F5-6. 通知: §6.5 の規則で通知先 pane を解決し `agent.prompt`。`agent_blocked` / 該当 pane 無しなら未通知として表示し「再送」を出す。同一 pane への通知は既定 10 秒のデバウンスでまとめる。文言は設定で変更可。
- F5-7. 保存先は SQLite `~/.config/herdr-web/herdr-web.db`。テーブル: `repos`、`reviews`、`review_entries`。drizzle でマイグレーション。
- F5-8. 一覧ビュー（`Review` タブ）: リポジトリ内の全レビューを状態・target・ファイル・到達可否で絞り込み、クリックで該当 diff（作業ツリーまたは該当 commit）を開く。
- F5-9. 作成・返信・解決・再アンカーはイベント WS で反映する。

### F6. `hw` CLI（エージェント向け）

- F6-1. 同リポジトリの Bun スクリプト。`bun build --compile` で単一バイナリ化。Hono RPC クライアントを使う。
- F6-2. 呼び出し元の worktree の解決順: `--worktree <path>` → `$HERDR_PANE_ID` から `pane.get` の `foreground_cwd` → `process.cwd()`。いずれも `git rev-parse --show-toplevel` でルートに正規化。
- F6-3. サブコマンド:
  ```
  hw review list [--all] [--commit <rev>] [--since <rev>] [--uncommitted] [--unreachable] [--json]
  hw review show <id> [--json]
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
- F8-5. グループ折りたたみ、表示モード切替、フォーカス / ピン留めのハイライト。
- F8-6. herdr イベントでリアルタイム更新。未接続時は「herdr 未接続」。
- F8-7. サイドバーは折りたたみ可能で幅はドラッグで変更できる。

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
  - `{ type: "pin", worktreeRoot | null }`
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

### 9.4 Hono RPC — review（Web UI と `hw` が共用）

| メソッド | パス                                                                                 | 説明                                                                       |
| -------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| GET      | `/api/review?repo=&worktree=&status=&commit=&since=&uncommitted=&unreachable=&path=` | 一覧。`worktree` を渡すと §6.5 の可視性で絞る                              |
| GET      | `/api/review/:id`                                                                    | 1 件（スレッド、アンカーのコンテキスト、現在の解決位置）                   |
| GET      | `/api/review/for-diff?repo=&from=&to=&path=`                                         | 指定 diff にアンカー一致するレビューと行位置                               |
| POST     | `/api/review`                                                                        | 作成 `{ repo, worktreeRoot, target, path, anchor, viewedAs, body }` → 通知 |
| POST     | `/api/review/:id/reply`                                                              | `{ body, author, agentSession? }`                                          |
| POST     | `/api/review/:id/resolve`                                                            | user のみ                                                                  |
| POST     | `/api/review/:id/reanchor`                                                           | 手動再アンカー                                                             |
| POST     | `/api/review/:id/notify`                                                             | 再送                                                                       |
| GET      | `/api/hw/whoami?pane=`                                                               | pane から `foreground_cwd`、worktree、`agent_session` を解決               |
| POST     | `/api/repo/move`                                                                     | `{ from, to }`                                                             |

### 9.5 herdr socket API の利用一覧

| 用途       | メソッド / イベント                        |
| ---------- | ------------------------------------------ |
| 接続確認   | `ping`                                     |
| 初期状態   | `session.snapshot`                         |
| 購読       | `events.subscribe`                         |
| pane 情報  | `pane.get`                                 |
| フォーカス | `pane.focus`（必要なら `workspace.focus`） |
| 通知       | `agent.prompt`                             |

## 10. 実装上の注意

- **bun-pty**: `bun:ffi` で Rust の dylib を読む。`bun build --compile` 時に dylib の同梱方法を M6 で確認する。
- **初回 resize**: 接続直後に送らないと初回描画が崩れる。
- **フォント**: herdr の TUI は Nerd Font を使う。xterm.js の `fontFamily` に指定する。
- **テーマ**: CSS 変数を 1 か所で定義し、shadcn、xterm の theme オブジェクト、`@pierre/diffs` の `--diffs-*` 変数へ流し込む。`@pierre/diffs` は Shadow DOM なので Tailwind は届かない。
- **git 解決のコスト**: cwd → 結果のキャッシュを持つ。
- **ブラウザのキー衝突**: `Ctrl+W` / `Ctrl+T` / `Ctrl+N` を `attachCustomKeyEventHandler` で握る。
- **herdr ソケット**: 購読用接続とリクエスト用接続を分ける。
- **CodeView の更新**: item の `id` に `version` を含めないと更新が無視される（tdiff の `reconcile.ts` を踏襲）。
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

| #   | 項目                                                | 状態                                                                                |
| --- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | `foreground_cwd` 変化で `pane.updated` が発火するか | 未確認（3 秒ポーリングをフォールバックとして実装済み）                              |
| 2   | schema の正確な形                                   | `herdr api schema --json` あり。valibot 手書きで対応                                |
| 3   | `agent.prompt` の Claude Code への入り方            | 済（Enter まで送られ通常のメッセージとして届く。10 秒デバウンス後の到達を実機確認） |
| 4   | PTY ライブラリ                                      | 済（node-pty は Bun で onData が来ない。bun-pty 採用、`env -i` で環境を置換）       |
| 5   | herdr TUI の xterm.js 描画                          | attach でバイト受信を確認。描画品質はブラウザで要確認                               |
| 6   | 移植範囲                                            | 済（§3）                                                                            |
| 7   | `agent_session` の形                                | 済（§3）                                                                            |
| 8   | サイドバー非表示キー                                | 済（`[ui] sidebar_collapsed_mode = "hidden"`）                                      |
| 9   | `pane.focus` の workspace 越え                      | 未確認。`workspace.focus` → `pane.focus` の順で呼ぶ安全側で実装                     |
| 10  | snapshot に `foreground_cwd`                        | 済（含まれる）                                                                      |
| 11  | 他エージェントの `agent_session`                    | 未確認                                                                              |
| 12  | `tailscale serve` 経由の WS                         | M6 で確認                                                                           |

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
- **M2: herdr 状態とフォーカス追従** — gateway（socket / fake）、state、focus、`/ws/events`、ピン留め。
- **M2.5: サイドバー** — tree 再構成、F8。
- **M3: diff** — tdiff 移植、`/api/git/patch` `/api/git/files`、poller、`repo-changed`。
- **M4: graph** — tgg 移植、`/api/git/graph` `/api/git/commit`、選択 → diff。
- **M5: レビュー + `hw`** — sqlite、domain、usecases、通知、Review タブ、CLI、再アンカー。
- **M6: ビルド・配布** — 単一バイナリ、設定、README。

## 15. 将来拡張

- レビューの MCP サーバー化
- `hw open <path|commit>`
- サイドバーからの workspace / worktree 操作
- worktree 横断比較
- git の書き込み操作
