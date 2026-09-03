// Pure state/reducer for the graph panel's cursor/detail-panel state. No
// DOM, no fetch — a plain function over plain data so it can be unit tested
// directly (state.test.ts). Ported from terminal-git-graph's
// src/client/state.ts; the `repo` field (there: a submodule sub-path) is
// unused in herdr-web, where `repo` is a prop on GraphPanel instead, but is
// kept so the reducer/actions stay a faithful, drop-in port.

export interface State {
  /** Unused in herdr-web (kept for parity with the ported reducer). */
  repo: string;
  selectedHash: string | null;
  all: boolean;
  max: number;
  /**
   * Whether CommitDetail is shown for `selectedHash`. Kept independent of
   * `selectedHash` itself so moving the cursor around the graph doesn't
   * force the detail panel open on every move — selecting a row toggles/
   * opens it.
   */
  detailOpen: boolean;
}

export type Action =
  | { type: "selectRepo"; repo: string }
  | { type: "selectHash"; hash: string | null; openDetail?: boolean }
  | { type: "setAll"; all: boolean }
  | { type: "toggleAll" }
  | { type: "setMax"; max: number }
  | { type: "doubleMax" }
  | { type: "toggleDetail" }
  | { type: "closeDetail" }
  /** Dispatched when the current `repo` is no longer available. */
  | { type: "repoUnavailable" };

export interface InitialStateOptions {
  all?: boolean;
  max?: number;
}

export function initialState(options: InitialStateOptions = {}): State {
  return {
    repo: "",
    selectedHash: null,
    all: options.all ?? true,
    max: options.max ?? 500,
    detailOpen: false,
  };
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case "selectRepo": {
      if (action.repo === state.repo) return state;
      // Repo switch clears the current selection — a hash from one repo's
      // graph means nothing in another's.
      return { ...state, repo: action.repo, selectedHash: null, detailOpen: false };
    }

    case "selectHash": {
      const openDetail = action.openDetail ?? state.detailOpen;
      return {
        ...state,
        selectedHash: action.hash,
        detailOpen: action.hash === null ? false : openDetail,
      };
    }

    case "setAll":
      return state.all === action.all ? state : { ...state, all: action.all };

    case "toggleAll":
      return { ...state, all: !state.all };

    case "setMax":
      return state.max === action.max ? state : { ...state, max: action.max };

    case "doubleMax":
      return { ...state, max: state.max * 2 };

    case "toggleDetail":
      if (state.selectedHash === null) return state;
      return { ...state, detailOpen: !state.detailOpen };

    case "closeDetail":
      return state.detailOpen ? { ...state, detailOpen: false } : state;

    case "repoUnavailable":
      if (state.repo === "") return state;
      return { ...state, repo: "", selectedHash: null, detailOpen: false };

    default:
      return state;
  }
}
