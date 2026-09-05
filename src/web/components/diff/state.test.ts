import assert from "node:assert/strict";
import { test } from "vitest";
import {
  DEFAULT_SETTINGS,
  initialBannerState,
  reduceBanner,
  updateBanner,
  validateSettings,
} from "./state.ts";
import type { BannerState } from "./state.ts";

// ---------------------------------------------------------------------------
// validateSettings
// ---------------------------------------------------------------------------

test("validateSettings: returns defaults for null/non-object input", () => {
  assert.deepEqual(validateSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(validateSettings(undefined), DEFAULT_SETTINGS);
  assert.deepEqual(validateSettings("nope"), DEFAULT_SETTINGS);
});

test("validateSettings: accepts each valid field", () => {
  const out = validateSettings({ diffStyle: "unified", overflow: "scroll" });
  assert.deepEqual(out, { diffStyle: "unified", overflow: "scroll" });
});

test("validateSettings: a bad field falls back to its own default, others unaffected", () => {
  const out = validateSettings({ diffStyle: "sideways", overflow: "scroll" });
  assert.equal(out.diffStyle, DEFAULT_SETTINGS.diffStyle);
  assert.equal(out.overflow, "scroll");
});

// ---------------------------------------------------------------------------
// banner reducer
// ---------------------------------------------------------------------------

test("reduceBanner: fetched before anything rendered raises no banner", () => {
  const state = reduceBanner(initialBannerState(), { type: "fetched", hash: "h1" });
  assert.equal(updateBanner(state), null);
  assert.equal(state.renderedHash, null);
});

test("reduceBanner: applied sets renderedHash and clears a matching pending banner", () => {
  let state: BannerState = initialBannerState();
  state = reduceBanner(state, { type: "applied", hash: "h1" });
  assert.equal(state.renderedHash, "h1");
  assert.equal(updateBanner(state), null);
});

test("reduceBanner: fetched with a different hash than rendered raises a banner", () => {
  let state: BannerState = initialBannerState();
  state = reduceBanner(state, { type: "applied", hash: "h1" });
  state = reduceBanner(state, { type: "fetched", hash: "h2" });
  assert.deepEqual(updateBanner(state), { text: "変更があります", hash: "h2" });
});

test("reduceBanner: fetched with the same hash as rendered clears any pending banner", () => {
  let state: BannerState = initialBannerState();
  state = reduceBanner(state, { type: "applied", hash: "h1" });
  state = reduceBanner(state, { type: "fetched", hash: "h2" });
  state = reduceBanner(state, { type: "fetched", hash: "h1" });
  assert.equal(updateBanner(state), null);
});

test("reduceBanner: applying the pending hash clears the banner", () => {
  let state: BannerState = initialBannerState();
  state = reduceBanner(state, { type: "applied", hash: "h1" });
  state = reduceBanner(state, { type: "fetched", hash: "h2" });
  state = reduceBanner(state, { type: "applied", hash: "h2" });
  assert.equal(state.renderedHash, "h2");
  assert.equal(updateBanner(state), null);
});
