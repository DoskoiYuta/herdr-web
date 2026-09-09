# herdr-web

## 開発中のサーバー反映

常用の herdr-web は `bun link` で PATH に張った `herdr-web`（このチェックアウトの `src/server/main.ts`）を
`--watch` 無しで 8080 に常駐させている（理由は README「起動」節）。そのため `src/server` 側の変更は
再起動しないと反映されない。実装が完了して green を確認したら、次で再起動する。

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN -t | xargs kill
(cd ~ && nohup herdr-web > ~/.config/herdr-web/server.log 2>&1 < /dev/null &)
hw status   # server: ok になることを確認
```

- `src/web` 側は Vite の HMR で反映されるので再起動不要。
- worktree で作業しているときも、8080 で動くのは main チェックアウトのソース。worktree の変更を
  実走で確かめるときは、その worktree で `bun src/server/main.ts --config <別 port・別 dbPath の config.json>`
  を起動して確認し、8080 は触らない（Vite の cacheDir も分ける）。
- `pkill -f main.ts` は使わない。別ポートで動いている seed ハーネスも同じエントリを実行している。
