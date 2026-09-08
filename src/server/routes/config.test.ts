import { describe, expect, test } from "bun:test";
import * as v from "valibot";
import { ClientConfigSchema } from "../../contract/config";
import { createTestApp } from "../testing/app-deps";

// 無いと壊れる: 設定ダイアログの「接続」タブが、このサーバーが実際に読んでいる
// 設定ファイル・DB のパスを一切出せなくなる（herdr の socket パスと違い、
// これはサーバー自身の情報なので API から出せる）。
describe("GET /api/config", () => {
  test("includes the config file and db paths this server is using", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/config");
    expect(res.status).toBe(200);
    const body = v.parse(ClientConfigSchema, await res.json());
    expect(body.paths).toEqual({ config: "/test/config.json", db: "/test/herdr-web.db" });
  });
});
