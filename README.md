# herdr-web

ブラウザから [herdr](https://herdr.dev) に attach し、その横でフォーカス中の pane が見ている worktree の diff / git graph を表示して、diff にレビューを付けてエージェントに返すための Web UI。設計は [plan.md](./plan.md)。

## 構成

- **サイドバー**: herdr の pane を `repository > workspace` に組み替えて表示。クリックでフォーカス切り替え。リポジトリ見出しの「+」ボタンからそのリポジトリの main worktree root を cwd にワークスペースを作成でき、ワークスペース行を右クリックすると「名前を変更」「削除」の操作ができる（削除は pane / agent がすべて終了する旨を確認してから実行）。
- **ターミナル**: herdr の TUI を PTY 経由で xterm.js に描画。既定の keybinds（後述）で Shift+← / Shift+→ に `ESC b` / `ESC f`（単語移動）を割り当てている。
- **ツール領域**: フォーカス pane のリポジトリ・ワークスペースまで追従し、その worktree（サブリポジトリを含む）は人間が選ぶ（[docs/ui-redesign.md §10](docs/ui-redesign.md)）。選択は `(workspace, repository)` ごとにサーバーへ保存され、複数ブラウザ・`hw` CLI から一致する。タブの選択もワークスペースごとにサーバーへ保存され、ワークスペースを切り替えると前回のタブに戻る。diff / graph / review / Docker / Process を表示。git graph は読み取り専用だが、`fetch` ボタン（キー `f`）から `git fetch --prune` だけは実行できる（リモート追跡ブランチの更新のみ、worktree は変更しない）。Process タブは他ユーザーが所有するプロセスの cwd を読めないため、それらは一覧に出ない。Files タブは `.md` と同様 `.html`/`.htm` もプレビュー/ソースを切り替えられる。プレビューは `srcdoc` の iframe のため相対パスの画像・CSS は解決されない。スクリプトは既定で無効（サンドボックス）で、ファイルごとに「スクリプトを許可」で明示的に有効化できる。Files タブはヘッダーの「編集」トグルとファイルごとの下書きで編集でき、「保存」または `Cmd+S`/`Ctrl+S` で `PUT /api/fs/file` により明示的に保存する（自動保存はしない）。`.md` はプレビュー（WYSIWYG）のままでも編集できる — Tiptap が正規化しない範囲は元の書式のまま保存される（触った段落だけ正規化された書式になり、その場合はビューアに注記が出る）。読み取り時の hash（git blob hash）と保存直前のディスク上の内容が一致しない場合は 409（衝突バナーから「上書き保存」/「破棄して再読込」を選べる）、`.git` 配下・symlink・非 UTF-8・書き込み権限が無いファイルは編集トグル自体が無効になる。
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
bun link           # ~/.bun/bin に `herdr-web`（サーバー）と `hw`（CLI）を張る。どちらもこのチェックアウトの src を直接実行する
herdr-web          # http://127.0.0.1:8080 （Vite HMR 込み、--watch 無し）
```

常駐させるときは `herdr-web`（または `bun run serve`）を使い、`bun run dev` の `--watch` は使わない。
`--watch` はソース変更のたびにサーバーを再起動するため、マイグレーションが途中まで
適用された状態でプロセスが再起動されることがある。サーバー側の変更は手で再起動して反映する（手順は `CLAUDE.md`）。

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
  },
  "ask": {
    "agents": ["claude", "codex", "gemini"],
    "defaultAgent": "claude"
  },
  "terminal": {
    "keybinds": { "shift+left": "b", "shift+right": "f" }
  }
}
```

- `dbPath` の既定は `~/.config/herdr-web/herdr-web.db`（SQLite, WAL）。
- `allowedRoots`: `$HOME` 配下以外のリポジトリを開きたいときに追加する。
- 環境変数 `PORT` / `HOST` が設定を上書きする。
- `ask.agents`: 質問の新規セッションで選べるエージェント種別。herdr の `agent.start` は `kind` に自由文字列を取り対応一覧を持たないため（`herdr agent start --help` にしか出ない）、ここで持つ。`ask.defaultAgent` が `agents` に無ければ起動時に警告して先頭に丸める。
- `terminal.keybinds`: ブラウザのターミナルで送信するキー割り当て。キーは Ghostty 風の `[mod+]...key` 書式（`mod` は `shift` / `alt`（`opt`, `option` も可）/ `ctrl` / `meta`（`cmd`, `super` も可）、大文字小文字は区別しない）、`key` は `left right up down home end pageup pagedown tab enter escape backspace delete insert space` と `f1`〜`f12`、または英数字・記号 1 文字。値は実際に送信する文字列（JSON なので ESC は ``）。
  - 既定値は Ghostty の単語移動相当（`shift+left`/`shift+right` → `ESC b`/`ESC f`）。
  - `"terminal": { "keybinds": {} }` にすると全部無効になる。
  - modifier の無い英数字・記号 1 文字（例 `"a"`）は通常入力を潰すため不正扱いになる（矢印などの特殊キーは modifier 無しでも可）。
  - パースできないキーや空文字の値は起動時に警告を出して無視され、残りの設定は使われる。

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

- レビューは **変更に付く**。未コミットなら worktree、コミット後は commit に紐づく。git graph は commit ごとのレビュー件数を表示する（旧 Review タブは廃止）。エージェントが今いる worktree から見えるレビュー（その worktree の未コミット分 + HEAD から到達可能な commit 分）が `hw review list` に出る。
- ユーザーがコード行（複数行の範囲も可）にコメントを書くと、それは **下書き** になる。返信も同様に下書きになる。下書きのあいだはエージェントから見えず、何も通知されない。
- Web UI の **送信** ボタンで、その worktree の下書きをまとめて送信する。送信すると各レビューは `open` に戻り（`resolved` だった場合も再オープン）、その worktree にいるエージェント pane へ `agent.prompt` で通知が 1 回だけ飛ぶ（件数入り、即時 = 待たない）。通知状態はレビューに保存され、UI に `未通知` / `通知済み` / `入力待ちで未達` / `宛先なし` / `不明` として出る。エージェントが入力待ち（`blocked`）なら入力待ちを解消してから「再送」する。herdr 未接続中は保留のまま再試行し、サーバー再起動後も保留分を引き継ぐ。
- resolve できるのはユーザーだけ。エージェントは返信しかできない。
- リポジトリのディレクトリを移動したら `hw repo move <old> <new>`。

### エージェントの指示ファイルに書くこと

`CLAUDE.md` / `AGENTS.md` 等に 3 行程度:

```
レビューコメントの通知を受けたら `hw review list` で確認し、`hw review show <id>` で該当箇所を読む。
対応後は `hw review reply <id> "<返答>"` で返答する（この返信も下書きになり、ユーザーが送信するまでは届かない）。
解決（resolve）の判断はユーザーが行うので、エージェントは resolve しない。
```

ユーザーが Notes に書いたメモは `hw notes list` / `hw notes show <id>` で読める（エージェントからの書き込みは無い）。

### `hw` CLI

```
hw review list [--all] [--commit <rev>] [--since <rev>] [--uncommitted] [--unreachable] [--json]
hw review show <id> [--json]   # <id> は `hw review list` が出す短縮 id（末尾一致）でよい
hw review reply <id> <text>
hw notes list [--worktree <path>] [--json]
hw notes show <id> [--json] [--no-metadata]   # <id> は `hw notes list` が出す短縮 id（末尾一致）でよい
hw status
hw repo move <old-path> <new-path>
```

宛先は `HW_URL`（既定 `http://127.0.0.1:8080`）。pane 内で実行すると `HERDR_PANE_ID` から自分の worktree を解決する。pane 外では `--worktree <path>` かカレントディレクトリを使う。

`hw status`/`whoami` が返す worktree は、そのペインのワークスペースに対して人間が Web UI で選んでいる worktree（サブリポジトリ選択中はサブリポジトリの実効 worktree）。何も選ばれていなければフォーカス pane の cwd が属する worktree が既定になる（[docs/ui-redesign.md §10](docs/ui-redesign.md)）。

## 判断依頼（AskUserQuestion の置き換え）

判断依頼 (decision) は、エージェントが人間の判断を仰ぐための非ブロッキングな仕組み。`hw decision request` は依頼を登録して即座に応答を返すだけで、回答を待たない。結果（回答・却下）は herdr の `agent.prompt` で呼び出し元 pane に届く。期限も既定回答も無いので、エージェントは依頼を出したらターンを終えて待つ。

### `.claude/skills/hw-decision/SKILL.md` の雛形

```markdown
---
name: hw-decision
description: AskUserQuestion の代わりに使う、herdr-web への判断依頼。ユーザーに選択・確認・自由記述を求めるときはこのスキルを使う。
---

AskUserQuestion の代わりに `hw decision request --file <json>` で判断依頼を出す。書式は `hw decision schema` で確認する（設問は `single` / `multi` / `text` / `confirm`、選択肢には `recommended` と `preview`、`context` と `preview` には markdown / code / diff / mermaid / svg / html / image / location / table の Block を積める。`layout: "compare"` で選択肢を横並び比較にできる）。

依頼を出したら「判断依頼 <id> を出しました。回答が届いたら続けます」とだけ言ってターンを終える。回答は次のユーザー発言として届く。不要になった依頼は `hw decision cancel <id>` で取り下げる。

stderr に「pane が特定できない」旨の警告が出たら、回答は自動で届かないので、標準出力の `url` を人間に伝える。
```

### AskUserQuestion を deny する例

`~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "echo '{\"hookSpecificOutput\":{\"hookEventName\":\"PreToolUse\",\"permissionDecision\":\"deny\",\"permissionDecisionReason\":\"AskUserQuestion の代わりに `hw decision request` を使ってください（`hw decision schema` で書式）\"}}'"
          }
        ]
      }
    ]
  }
}
```

deny すると、プランモードの確認など Claude Code の組み込み UI が AskUserQuestion を使う場面でも一律に使えなくなる。

### 既知の制限

- `--wait` のような同期待ちのコマンドは無い。回答は `agent.prompt` の到着を待つしかない。
- pane が消えている（herdr セッションが終了した等）と配達できない。その場合は Web UI の依頼ビューから「再送」する。

`hw` はユーザーの設定ファイル（`~/.claude/settings.json` や `CLAUDE.md`/`AGENTS.md`）を書き換えない。上記のスキル/hook は手動で設置する。

## 開発

```bash
bun run check      # typecheck + lint (oxlint, dependency-cruiser) + fmt:check + test
bun run test:server
bun run test:web
bun run db:generate   # drizzle マイグレーション生成 + 埋め込みファイル更新
```

依存方向は `.dependency-cruiser.cjs` で検証する。`src/contract` は葉、`src/web` と `src/cli` は `src/contract`（と型のみ `src/server/app`）だけを import する。`src/server/review` はヘキサゴナル（domain → ports → usecases / adapters）。
