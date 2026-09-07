/**
 * React Context wrapper around herdrStore.ts. A component that needs herdr
 * state or WS event fan-out reads it directly via these hooks instead of
 * receiving it through props from its parents.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AskEvent } from "@contract/ask";
import type { DecisionEvent } from "@contract/decision";
import type { ClientEventMessage } from "@contract/events";
import {
  createHerdrStore,
  useHerdrStore as subscribeToStore,
  type CreateHerdrStoreOptions,
  type HerdrStore,
  type HerdrStoreState,
  type ReviewEvent,
} from "./herdrStore";

const HerdrStoreCtx = createContext<HerdrStore | null>(null);

export type HerdrStoreProviderProps = {
  children: ReactNode;
  /** テスト用にストア実装を差し替える。省略時は `createHerdrStore` で 1 つ作り、
   * mount で開いて unmount で閉じる。 */
  store?: HerdrStore;
  options?: CreateHerdrStoreOptions;
};

export function HerdrStoreProvider({ children, store, options }: HerdrStoreProviderProps) {
  // レイジー初期化（useState(() => ...)）を使う: `useRef(createHerdrStore())` は
  // 引数を毎レンダーで評価してしまい、破棄される store ごとに /ws/events への
  // 接続が張られてしまう。
  const [owned] = useState(() => store ?? createHerdrStore({ autoOpen: false, ...options }));
  useEffect(() => {
    if (store) return; // 注入されたストアは呼び出し側が開閉を管理する
    owned.open();
    return () => owned.close();
  }, [owned, store]);

  return <HerdrStoreCtx.Provider value={owned}>{children}</HerdrStoreCtx.Provider>;
}

function useStore(): HerdrStore {
  const store = useContext(HerdrStoreCtx);
  if (!store)
    throw new Error("useHerdrState/useHerdrStoreActions must be used under HerdrStoreProvider");
  return store;
}

export function useHerdrState(): HerdrStoreState {
  const store = useStore();
  return subscribeToStore(store);
}

export function useHerdrStoreActions(): { send: (message: ClientEventMessage) => void } {
  const store = useStore();
  return useMemo(() => ({ send: store.send }), [store]);
}

/** 最新の `value` を ref に保持する。ref への書き込みは effect の中で行う
 * （レンダー中に ref を書き換えるのは避ける）。 */
function useLatestRef<T>(value: T) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** WS イベント購読の共通実装。`cb` は毎レンダー新しい関数でよい — 最新の `cb` を
 * ref に保持し、effect の依存配列には `subscribe`（store のメソッドで安定）の
 * みを積むことで、呼び出し側が `useCallback` で安定させる必要をなくす。 */
function useEventSubscription<E>(
  subscribe: (cb: (event: E) => void) => () => void,
  cb: (event: E) => void,
): void {
  const cbRef = useLatestRef(cb);
  useEffect(() => subscribe((event) => cbRef.current(event)), [subscribe, cbRef]);
}

export function useReviewEvents(cb: (event: ReviewEvent) => void): void {
  const store = useStore();
  useEventSubscription(store.subscribeReviewEvents, cb);
}

export function useAskEvents(cb: (event: AskEvent) => void): void {
  const store = useStore();
  useEventSubscription(store.subscribeAskEvents, cb);
}

export function useDecisionEvents(cb: (event: DecisionEvent) => void): void {
  const store = useStore();
  useEventSubscription(store.subscribeDecisionEvents, cb);
}
