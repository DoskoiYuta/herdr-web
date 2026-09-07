import { render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { createLocalStorageStore } from "./localStorageStore";

interface Fixture {
  n: number;
}

function makeStore(key: string) {
  return createLocalStorageStore<Fixture>({
    key,
    defaultValue: { n: 0 },
    validate: (raw, defaults) => {
      if (raw && typeof raw === "object" && typeof (raw as Fixture).n === "number") {
        return raw as Fixture;
      }
      return defaults;
    },
  });
}

beforeEach(() => {
  localStorage.clear();
});

describe("createLocalStorageStore: plain get/set", () => {
  test("get() returns the default before anything is set", () => {
    const store = makeStore("t1");
    expect(store.get()).toEqual({ n: 0 });
  });

  test("set() persists to localStorage and get() reflects it", () => {
    const store = makeStore("t2");
    store.set({ n: 5 });
    expect(store.get()).toEqual({ n: 5 });
    expect(JSON.parse(localStorage.getItem("t2")!)).toEqual({ n: 5 });
  });

  test("a fresh store instance for the same key reads the persisted value", () => {
    const a = makeStore("t3");
    a.set({ n: 7 });
    const b = makeStore("t3");
    expect(b.get()).toEqual({ n: 7 });
  });
});

// The bug this whole store exists to fix: two independent components (e.g.
// an open DiffPanel and the settings dialog) sharing one localStorage key
// must see each other's writes without a remount.
describe("createLocalStorageStore: cross-component reactivity", () => {
  function Reader({ store, id }: { store: ReturnType<typeof makeStore>; id: string }) {
    const [value] = store.useStore();
    return <span data-testid={id}>{value.n}</span>;
  }
  function Writer({ store }: { store: ReturnType<typeof makeStore> }) {
    const [, set] = store.useStore();
    return (
      <button type="button" onClick={() => set({ n: 42 })}>
        write
      </button>
    );
  }

  test("a write from one mounted component is immediately visible in another mounted component", () => {
    const store = makeStore("t4");
    render(
      <>
        <Reader store={store} id="reader" />
        <Writer store={store} />
      </>,
    );
    expect(screen.getByTestId("reader")).toHaveTextContent("0");

    fireEvent.click(screen.getByText("write"));

    expect(screen.getByTestId("reader")).toHaveTextContent("42");
  });
});

describe("createLocalStorageStore: cross-tab storage event", () => {
  test("a storage event for this key notifies subscribers", () => {
    const store = makeStore("t5");
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    localStorage.setItem("t5", JSON.stringify({ n: 9 }));
    window.dispatchEvent(new StorageEvent("storage", { key: "t5" }));

    expect(notified).toBe(1);
    expect(store.get()).toEqual({ n: 9 });
  });

  test("a storage event for a different key does not notify", () => {
    const store = makeStore("t6");
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });

    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));

    expect(notified).toBe(0);
  });
});
