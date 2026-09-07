/**
 * Test helpers for components that read herdr state from Context (F14-5) and/or
 * drive their own state through the router (F14-1..4). Kept to what the
 * existing component tests actually need: a fake store with the same shape
 * `HerdrStoreContext` expects, plus a minimal memory-history router for the
 * two components that read route params/search directly (`ToolPane`).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { render as rtlRender } from "@testing-library/react";
import type { ReactElement } from "react";
import { vi } from "vitest";
import type { AskEvent } from "@contract/ask";
import type { DecisionEvent } from "@contract/decision";
import { HerdrStoreProvider } from "@/lib/HerdrStoreContext";
import type { HerdrStore, HerdrStoreState, ReviewEvent } from "@/lib/herdrStore";
import { parseToolSearch } from "@/router/search";

export type FakeHerdrStore = HerdrStore & {
  setState: (next: Partial<HerdrStoreState>) => void;
  emitReview: (event: ReviewEvent) => void;
  emitAsk: (event: AskEvent) => void;
  emitDecision: (event: DecisionEvent) => void;
};

/** A `HerdrStore` implementation driven entirely in-memory, for components
 * that read `useHerdrState()` / `useReviewEvents()` etc. without a real
 * `/ws/events` connection. `setState` re-renders every subscriber (mirrors
 * herdrStore.ts's own `setState`); `emitXxx` fans out to that event's
 * listeners only, matching the real store's separate ring buffers. */
export function makeFakeStore(initial: Partial<HerdrStoreState> = {}): FakeHerdrStore {
  let state: HerdrStoreState = {
    repos: [],
    focus: null,
    herdr: { connected: true, protocol: 1 },
    connection: "open",
    repoChanged: {},
    ...initial,
  };
  const listeners = new Set<() => void>();
  const reviewListeners = new Set<(event: ReviewEvent) => void>();
  const askListeners = new Set<(event: AskEvent) => void>();
  const decisionListeners = new Set<(event: DecisionEvent) => void>();

  return {
    getState: () => state,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    subscribeReviewEvents: (cb) => {
      reviewListeners.add(cb);
      return () => reviewListeners.delete(cb);
    },
    getReviewEvents: () => [],
    subscribeAskEvents: (cb) => {
      askListeners.add(cb);
      return () => askListeners.delete(cb);
    },
    getAskEvents: () => [],
    subscribeDecisionEvents: (cb) => {
      decisionListeners.add(cb);
      return () => decisionListeners.delete(cb);
    },
    getDecisionEvents: () => [],
    send: vi.fn(),
    open: () => {},
    close: () => {},
    setState(next) {
      state = { ...state, ...next };
      for (const cb of listeners) cb();
    },
    emitReview(event) {
      for (const cb of reviewListeners) cb(event);
    },
    emitAsk(event) {
      for (const cb of askListeners) cb(event);
    },
    emitDecision(event) {
      for (const cb of decisionListeners) cb(event);
    },
  };
}

/** Renders `ui` under `HerdrStoreProvider` + `QueryClientProvider` only — for
 * components that read the store via Context but don't touch the router
 * (`DiffPanel`, `FilesPanel`, `Sidebar` and friends, `DecisionView`/`DecisionListView`). */
export function renderWithStore(ui: ReactElement, opts: { store?: FakeHerdrStore } = {}) {
  const store = opts.store ?? makeFakeStore();
  const queryClient = new QueryClient();
  const wrap = (next: ReactElement) => (
    <QueryClientProvider client={queryClient}>
      <HerdrStoreProvider store={store}>{next}</HerdrStoreProvider>
    </QueryClientProvider>
  );
  const utils = rtlRender(wrap(ui));
  // Plain RTL `rerender(nextUi)` would replace the whole wrapped tree,
  // dropping the providers — re-wrap so callers can rerender with new props
  // and keep the same store/query client.
  const rerender = (next: ReactElement) => utils.rerender(wrap(next));
  return { ...utils, rerender, store };
}

/** Renders `component` (typically `ToolPane`) as the leaf of a minimal
 * `/focus/$tab` + `/w/$root/$tab` route tree with a memory history, so it can
 * read `useParams`/`useSearch`/`useNavigate` exactly as it does in the real
 * app. `path` picks which of the two routes is active for this render. */
export async function renderWithRouter(
  component: () => ReactElement,
  opts: { path?: string; store?: FakeHerdrStore } = {},
) {
  const store = opts.store ?? makeFakeStore();
  const queryClient = new QueryClient();
  const rootRoute = createRootRoute({ component: () => <Outlet /> });
  const focusRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/focus/$tab",
    validateSearch: parseToolSearch,
    component,
  });
  const wRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/w/$root/$tab",
    validateSearch: parseToolSearch,
    // Mirrors router.tsx's wRoute: only a `root` change should remount the
    // component, not a `tab`/search-only navigation within the same root.
    remountDeps: ({ params }) => params.root,
    component,
  });
  const routeTree = rootRoute.addChildren([focusRoute, wRoute]);
  const history = createMemoryHistory({ initialEntries: [opts.path ?? "/focus/diff"] });
  const router = createRouter({ routeTree, history });
  // Route matching (even with no loaders) resolves on a microtask — load it
  // before mounting so the first render already has content, instead of
  // callers needing `waitFor` around every assertion.
  await router.load();
  const utils = rtlRender(
    <QueryClientProvider client={queryClient}>
      <HerdrStoreProvider store={store}>
        <RouterProvider router={router} />
      </HerdrStoreProvider>
    </QueryClientProvider>,
  );
  return { ...utils, router, store };
}
