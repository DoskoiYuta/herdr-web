import { hc } from "hono/client";
import { describe, expect, test } from "bun:test";
import type { AppType } from "./app";

/**
 * Compile-only check: `AppType`'s method-chained construction in
 * `createApp` (see src/server/app.ts) must stay fully typed so Hono RPC's
 * `hc<AppType>()` can derive typed client calls for every mounted route,
 * including the git sub-app mounted at `/api/git`. This never issues a
 * network request; it only has to type-check.
 */
describe("AppType RPC typing", () => {
  test("hc<AppType> exposes typed calls for the git routes", () => {
    const client = hc<AppType>("http://localhost:8080");

    // Referencing (not calling) these confirms the route tree/typed query
    // params survive the `.route("/api/git", gitRoutes(...))` mount.
    const patchCall = client.api.git.patch.$get;
    const filesCall = client.api.git.files.$get;
    const graphCall = client.api.git.graph.$get;
    const rootCall = client.api.git.root.$get;
    const commitCall = client.api.git.commit[":hash"].$get;

    expect(typeof patchCall).toBe("function");
    expect(typeof filesCall).toBe("function");
    expect(typeof graphCall).toBe("function");
    expect(typeof rootCall).toBe("function");
    expect(typeof commitCall).toBe("function");
  });
});
