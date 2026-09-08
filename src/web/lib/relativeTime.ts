// 「いま / N分前 / N時間前 / N日前」の短い相対時刻表示。ThreadCard のメッセージ
// 時刻、Decisions 一覧の作成時刻など、画面を跨いで同じ書式を使う箇所で共有する。
import { useEffect, useState } from "react";

export function relativeTime(atIso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - new Date(atIso).getTime()) / 60_000));
  if (minutes < 1) return "いま";
  if (minutes < 60) return `${minutes}分前`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}時間前`;
  return `${Math.round(hours / 24)}日前`;
}

/** 60 秒ごとに再レンダーして相対時刻を進める。初期値は lazy initializer で
 * 1 度だけ読む（レンダー本体で `Date.now()` を直接呼ぶと impure になる）。 */
export function useNow(): number {
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);
  return nowMs;
}
