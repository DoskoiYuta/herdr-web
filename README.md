# herdr-web

ブラウザから [herdr](https://herdr.dev) に attach し、その横でフォーカス中の pane が見ている worktree の diff / git graph を表示して、diff にレビューを付けてエージェントに返すための Web UI。設計は [plan.md](./plan.md)。

## 構成

- **サイドバー**: herdr の pane を `repository > workspace` に組み替えて表示。クリックでフォーカス切り替え。リポジトリ見出しの「+」ボタンからそのリポジトリの main worktree root を cwd にワークスペースを作成でき、ワークスペース行を右クリックすると「名前を変更」「削除」の操作ができる（削除は pane / agent がすべて終了する旨を確認してから実行）。
- **ターミナル**: herdr の TUI を PTY 経由で xterm.js に描画。
- **ツール領域**: フォーカス pane の `foreground_cwd` に追従して diff / graph / review を表示。ピン留め可。git graph は読み取り専用だが、`fetch` ボタン（キー `f`）から `git fetch --prune` だけは実行できる（リモート追跡ブランチの更新のみ、worktree は変更しない）。
- **`hw` CLI**: pane 内のエージェントがレビューを読み・返答する。

## 必要なもの

- Bun 1.4 以上
- herdr 0.8 以上（`herdr` がサーバーとして起動していること。socket は `~/.config/herdr/herdr.sock`）
- git
- ブラウザ側に Nerd Font（既定は `JetBrainsMono Nerd Font`。無いと herdr のアイコンが豆腐になる）

herdr 自身のサイドバーは `~/.config/herdr/config.toml` で隠す。

```toml
[ui]
sidebar_collapsed_mode = "hidden"
```

## 起動

```bash
bun install
bun run dev        # http://127.0.0.1:8080 （Vite HMR 込み）
```

本番相当:

```bash
bun run build      # dist/web と dist/herdr-web, dist/hw を生成
./dist/herdr-web   # 静的ファイル同梱の単一バイナリ
```

## 設定

`~/.config/herdr-web/config.json`（`--config <path>` で上書き）。すべて省略可。不正な値があれば起動時に理由を表示して既定値で続行する。

```json
{
  "port": 8080,
  "host": "127.0.0.1",
  "herdrSession": null,
  "herdrSocketPath": null,
  "herdrBin": "herdr",
  "dbPath": null,
  "allowedRoots": [],
  "pollIntervalMs": 1000,
  "focusPollMs": 3000,
  "graphInitialCommits": 200,
  "notify": {
    "debounceMs": 10000,
    "template": "レビューコメントが {count} 件あります。`hw review list` で確認して対応してください。"
  }
}
```

- `dbPath` の既定は `~/.config/herdr-web/herdr-web.db`（SQLite, WAL）。
- `allowedRoots`: `$HOME` 配下以外のリポジトリを開きたいときに追加する。
- 環境変数 `PORT` / `HOST` が設定を上書きする。

## 出先からのアクセス

Web UI は `127.0.0.1` にしか bind しない。tailnet から使うときは Tailscale で loopback を公開する。

```bash
tailscale serve --bg 8080
# → https://<host>.<tailnet>.ts.net/
```

- **Web UI 自身は認証を持たない。** ブラウザから到達できる者は、サーバーを起動したユーザーと同じ権限（ターミナル操作、リポジトリ読み取り、エージェントへのプロンプト送信）を持つ。誰が繋げるかは Tailscale の ACL で制御する。
- `tailscale serve` を止めれば外からは届かない。
- `--host` や `HOST` で非 loopback に bind すると起動時に警告を出す。緊急用。

## レビューの運用

- レビューは **変更に付く**。未コミットなら worktree、コミット後は commit に紐づく。エージェントが今いる worktree から見えるレビュー（その worktree の未コミット分 + HEAD から到達可能な commit 分）が `hw review list` に出る。
- 作成時、その worktree にいるエージェント pane へ `agent.prompt` で通知する（10 秒デバウンス）。通知状態はレビューに保存され、UI に `未通知` / `通知済み` / `入力待ちで未達` / `宛先なし` / `不明` として出る。エージェントが入力待ち（`blocked`）なら入力待ちを解消してから「再送」する。herdr 未接続中は保留のまま再試行し、サーバー再起動後も保留分を引き継ぐ。
- resolve できるのはユーザーだけ。エージェントは返信しかできない。
- リポジトリのディレクトリを移動したら `hw repo move <old> <new>`。

### エージェントの指示ファイルに書くこと

`CLAUDE.md` / `AGENTS.md` 等に 3 行程度:

```
レビューコメントの通知を受けたら `hw review list` で確認し、`hw review show <id>` で該当箇所を読む。
対応後は `hw review reply <id> "<返答>"` で返答する。
解決（resolve）の判断はユーザーが行うので、エージェントは resolve しない。
```

### `hw` CLI

```
hw review list [--all] [--commit <rev>] [--since <rev>] [--uncommitted] [--unreachable] [--json]
hw review show <id> [--json]
hw review reply <id> <text>
hw status
hw repo move <old-path> <new-path>
```

宛先は `HW_URL`（既定 `http://127.0.0.1:8080`）。pane 内で実行すると `HERDR_PANE_ID` から自分の worktree を解決する。pane 外では `--worktree <path>` かカレントディレクトリを使う。

## 開発

```bash
bun run check      # typecheck + lint (oxlint, dependency-cruiser) + fmt:check + test
bun run test:server
bun run test:web
bun run db:generate   # drizzle マイグレーション生成 + 埋め込みファイル更新
```

依存方向は `.dependency-cruiser.cjs` で検証する。`src/contract` は葉、`src/web` と `src/cli` は `src/contract`（と型のみ `src/server/app`）だけを import する。`src/server/review` はヘキサゴナル（domain → ports → usecases / adapters）。
