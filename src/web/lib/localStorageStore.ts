// A tiny `useSyncExternalStore`-based store over one localStorage key,
// shared by every reader (viewerSettings, diff/state's Settings, …). A
// plain per-component `useState(() => load())` (the old approach) reads
// localStorage once at mount and never again — two mounted consumers (e.g.
// an open DiffPanel and the settings dialog) drift apart the moment either
// one writes, because neither re-renders off the other's write. This store
// fixes that: every `set()` notifies every subscriber synchronously, and a
// `storage` event (a write from another tab) does the same.

import { useSyncExternalStore } from "react";

export interface LocalStorageStore<T> {
  get(): T;
  set(partial: Partial<T>): void;
  subscribe(listener: () => void): () => void;
  useStore(): [T, (partial: Partial<T>) => void];
}

export interface LocalStorageStoreOptions<T> {
  key: string;
  defaultValue: T;
  /** Same defensive-validation contract as elsewhere in this codebase: a
   * corrupted/partial persisted value falls back field-by-field rather than
   * invalidating the whole object. */
  validate(raw: unknown, defaults: T): T;
}

export function createLocalStorageStore<T extends object>(
  opts: LocalStorageStoreOptions<T>,
): LocalStorageStore<T> {
  // Cached by the raw string so `get()` only re-parses/re-validates when the
  // underlying storage actually changed — required for useSyncExternalStore,
  // which re-renders in a loop if getSnapshot returns a new object identity
  // on every call for an unchanged value.
  let cachedRaw: string | null | undefined;
  let cachedValue: T = opts.defaultValue;
  const listeners = new Set<() => void>();

  function readRaw(): string | null {
    try {
      return localStorage.getItem(opts.key);
    } catch {
      return null;
    }
  }

  function get(): T {
    const raw = readRaw();
    if (raw === cachedRaw) return cachedValue;
    cachedRaw = raw;
    if (!raw) {
      cachedValue = { ...opts.defaultValue };
      return cachedValue;
    }
    try {
      cachedValue = opts.validate(JSON.parse(raw), opts.defaultValue);
    } catch {
      cachedValue = { ...opts.defaultValue };
    }
    return cachedValue;
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  function set(partial: Partial<T>): void {
    const next = { ...get(), ...partial };
    const raw = JSON.stringify(next);
    try {
      localStorage.setItem(opts.key, raw);
    } catch {
      // ignore — the change still applies in-memory for this tab this session
    }
    cachedRaw = raw;
    cachedValue = next;
    notify();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  if (typeof window !== "undefined") {
    window.addEventListener("storage", (event) => {
      if (event.key === opts.key) notify();
    });
  }

  function useStore(): [T, (partial: Partial<T>) => void] {
    const snapshot = useSyncExternalStore(subscribe, get, () => opts.defaultValue);
    return [snapshot, set];
  }

  return { get, set, subscribe, useStore };
}
