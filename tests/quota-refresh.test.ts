import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryDatabase } from "../src/core/history-db.js";
import { QuotaClient } from "../src/core/quota-client.js";

let directory: string;
let database: HistoryDatabase;
const originalFetch = globalThis.fetch;

function setAccount(accountId: string, accessToken = `fixture-${accountId}`): void {
  writeFileSync(join(directory, "auth.json"), JSON.stringify({ tokens: { account_id: accountId, access_token: accessToken } }));
}

function quotaPayload(plan = "plus", credits = 0, used = 50) {
  return { plan_type: plan, rate_limit_reset_credits: { available_count: credits },
    rate_limit: { primary_window: { used_percent: used, limit_window_seconds: 18000, reset_after_seconds: 3600 } } };
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "codex-quota-refresh-"));
  database = new HistoryDatabase(":memory:");
  await database.init();
  setAccount("account-a");
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

test("switching accounts bypasses a fresh cache without creating upgrade or credit events", async () => {
  const client = new QuotaClient(directory, database);
  globalThis.fetch = async () => new Response(JSON.stringify(quotaPayload()));
  expect((await client.getQuotaSnapshot()).accountId).toBe("account-a");

  setAccount("account-b");
  globalThis.fetch = async () => new Response(JSON.stringify(quotaPayload("pro", 3)));
  const switched = await client.getQuotaSnapshot();
  expect(switched.accountId).toBe("account-b");
  expect(switched.planType).toBe("pro");
  expect(database.getResetEvents()).toHaveLength(0);
  expect(database.getPlanChangeEvents()).toHaveLength(0);
  expect(JSON.parse(readFileSync(join(directory, "codex_quota_snapshot.json"), "utf8")).accountId).toBe("account-b");

  const restarted = new QuotaClient(directory, database);
  globalThis.fetch = async () => new Response(JSON.stringify(quotaPayload("pro", 4)));
  await restarted.getQuotaSnapshot(true);
  expect(database.getResetEvents()).toHaveLength(1);
  expect(database.getResetEvents()[0].creditDelta).toBe(1);
});

test("a legacy cache without an account establishes a baseline instead of fictional events", async () => {
  const legacy = new QuotaClient(directory).parseWhamResponse(quotaPayload("free", 0));
  delete legacy.accountId;
  writeFileSync(join(directory, "codex_quota_snapshot.json"), JSON.stringify(legacy));
  const client = new QuotaClient(directory, database);
  globalThis.fetch = async () => new Response(JSON.stringify(quotaPayload("pro", 5)));
  expect((await client.getQuotaSnapshot()).accountId).toBe("account-a");
  expect(database.getResetEvents()).toHaveLength(0);
  expect(database.getPlanChangeEvents()).toHaveLength(0);
});

test("future cache timestamps trigger a normal refresh", async () => {
  const future = new QuotaClient(directory).parseWhamResponse({ account_id: "account-a", ...quotaPayload() });
  future.updatedAt = Date.now() + 86400000;
  writeFileSync(join(directory, "codex_quota_snapshot.json"), JSON.stringify(future));
  const client = new QuotaClient(directory, database);
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response(JSON.stringify(quotaPayload("plus", 0, 80))); };
  expect((await client.getQuotaSnapshot()).fiveHour?.usedPercent).toBe(80);
  expect(requests).toBe(1);
  await client.getQuotaSnapshot();
  expect(requests).toBe(1);
});

test("concurrent forced refreshes for the same account share one HTTP request", async () => {
  const client = new QuotaClient(directory, database);
  let finish!: (response: Response) => void;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Promise<Response>((resolve) => { finish = resolve; }); };
  const first = client.getQuotaSnapshot(true);
  const second = client.getQuotaSnapshot(true);
  expect(requests).toBe(1);
  finish(new Response(JSON.stringify(quotaPayload("plus", 0, 80))));
  const results = await Promise.all([first, second]);
  expect(results.map((snapshot) => snapshot.fiveHour?.usedPercent)).toEqual([80, 80]);
  expect(client.getCachedQuotaSnapshot().fiveHour?.usedPercent).toBe(80);
});

for (const fails of [false, true]) {
  test(`an account switch without a new request discards an old ${fails ? "failure" : "success"}`, async () => {
    const client = new QuotaClient(directory, database);
    globalThis.fetch = async () => new Response(JSON.stringify(quotaPayload()));
    await client.getQuotaSnapshot(true);
    let completeOld!: (response: Response) => void;
    let rejectOld!: (reason: Error) => void;
    globalThis.fetch = async () => new Promise<Response>((resolve, reject) => { completeOld = resolve; rejectOld = reject; });
    const oldRequest = client.getQuotaSnapshot(true);
    setAccount("account-b");
    if (fails) rejectOld(new Error("old account failure"));
    else completeOld(new Response(JSON.stringify(quotaPayload("plus", 1))));
    const ignored = await oldRequest;
    expect(ignored.source).toBe("fallback");
    expect(ignored.accountId).toBeUndefined();
    expect(ignored.errorReason).toContain("登入狀態已變更");
    expect(client.getCachedQuotaSnapshot().source).toBe("fallback");
    expect(database.getResetEvents()).toHaveLength(0);
  });

  for (const nextAccount of ["account-a", "account-b"]) {
    test(`a delayed ${fails ? "failure" : "success"} cannot overwrite ${nextAccount === "account-a" ? "rotated credentials" : "a newer account"}`, async () => {
      const client = new QuotaClient(directory, database);
      let completeOld!: (response: Response) => void;
      let rejectOld!: (reason: Error) => void;
      globalThis.fetch = async () => new Promise<Response>((resolve, reject) => { completeOld = resolve; rejectOld = reject; });
      const oldRequest = client.getQuotaSnapshot(true);
      setAccount(nextAccount, "rotated-fixture-token");
      globalThis.fetch = async () => new Response(JSON.stringify(quotaPayload("pro", 3, 80)));
      await client.getQuotaSnapshot(true);
      if (fails) rejectOld(new Error("old account failure"));
      else completeOld(new Response(JSON.stringify(quotaPayload("plus", 0, 50))));
      await oldRequest;
      const current = client.getCachedQuotaSnapshot();
      expect(current.accountId).toBe(nextAccount);
      expect(current.fiveHour?.usedPercent).toBe(80);
      expect(current.source).toBe("wham");
      expect(current.errorReason).toBeUndefined();
      expect(database.getResetEvents()).toHaveLength(0);
      expect(database.getPlanChangeEvents()).toHaveLength(0);
    });
  }
}
