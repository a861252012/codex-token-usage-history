import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { QuotaClient } from "../src/core/quota-client.js";

describe("QuotaClient", () => {
  test("倒數秒數格式化 formatCountdown", () => {
    expect(QuotaClient.formatCountdown(0)).toBe("即將重設");
    expect(QuotaClient.formatCountdown(-10)).toBe("即將重設");
    expect(QuotaClient.formatCountdown(45)).toBe("0分 45秒");
    expect(QuotaClient.formatCountdown(150)).toBe("2分 30秒");
    expect(QuotaClient.formatCountdown(3700)).toBe("1小時 1分");
    expect(QuotaClient.formatCountdown(90000)).toBe("1天 1小時");
  });

  test("當未登入或離線時能安全產出 fallback 快照且不崩潰", async () => {
    const client = new QuotaClient("/non_existent_folder_xyz");
    const snapshot = await client.getQuotaSnapshot();
    expect(snapshot).toBeDefined();
    expect(snapshot.source).toBe("fallback");
    expect(snapshot.email).toBeNull();
  });

  test("限制異常 WHAM 數值、文字長度與附加配額數量", () => {
    const client = new QuotaClient("/non_existent_folder_xyz");
    const snapshot = client.parseWhamResponse({
      email: "e".repeat(1_000),
      plan_type: "p".repeat(1_000),
      rate_limit: {
        primary_window: {
          used_percent: Number.POSITIVE_INFINITY,
          limit_window_seconds: 300 * 60,
          reset_after_seconds: -1,
          reset_at: Number.POSITIVE_INFINITY,
        },
      },
      additional_rate_limits: Array.from({ length: 150 }, (_, index) => ({
        limit_name: `limit-${index}`,
        metered_feature: "feature",
        rate_limit: {},
      })),
      rate_limit_reset_credits: { available_count: -10 },
    });

    expect(snapshot.email).toHaveLength(320);
    expect(snapshot.planType).toHaveLength(320);
    expect(snapshot.fiveHour).toBeNull();
    expect(snapshot.errorReason).toContain("無效配額視窗");
    expect(snapshot.resetCredits).toBe(0);
    expect(snapshot.additionalLimits).toHaveLength(100);
  });

  test("missing or invalid usage percentages never become a fresh 100-percent window", () => {
    const client = new QuotaClient("/non_existent_folder_xyz");
    for (const value of [undefined, null, "0", NaN, Infinity, -1, 101]) {
      const snapshot = client.parseWhamResponse({ rate_limit: { primary_window: { used_percent: value as number, limit_window_seconds: 18000 } } });
      expect(snapshot.fiveHour).toBeNull();
      expect(snapshot.errorReason).toBeTruthy();
    }
    const valid = client.parseWhamResponse({ rate_limit: { primary_window: { used_percent: 0, limit_window_seconds: 18000 } } });
    expect(valid.fiveHour?.remainingPercent).toBe(100);
    expect(valid.fiveHour?.resetAtMs).toBe(0);
    expect(valid.fiveHour?.resetCountdown).toBe("—");
    expect(valid.errorReason).toBeUndefined();
  });

  test("成功取得快照後遭遇 401/連線失敗/缺少憑證時，回傳保留原資料之本機快取並標註失敗原因", async () => {
    const scratchDir = join(tmpdir(), `codex_quota_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    mkdirSync(scratchDir, { recursive: true });
    const authPath = join(scratchDir, "auth.json");
    writeFileSync(authPath, JSON.stringify({
      tokens: { access_token: "test-token", account_id: "test-account" },
    }));

    const client = new QuotaClient(scratchDir);
    const originalFetch = globalThis.fetch;

    try {
      // 1. 成功取得 200 OK
      globalThis.fetch = async () => new Response(JSON.stringify({
        email: "test@example.com",
        plan_type: "pro",
        rate_limit: {
          secondary_window: { used_percent: 15, limit_window_seconds: 604800, reset_after_seconds: 3600 },
        },
      }), { status: 200 });

      const fresh = await client.getQuotaSnapshot(true);
      expect(fresh.source).toBe("wham");
      expect(fresh.email).toBe("test@example.com");
      const originalUpdatedAt = fresh.updatedAt;

      globalThis.fetch = async () => new Response(JSON.stringify({ rate_limit: { primary_window: { used_percent: null, limit_window_seconds: 18000 } } }), { status: 200 });
      const invalidResponse = await client.getQuotaSnapshot(true);
      expect(invalidResponse.source).toBe("cache");
      expect(invalidResponse.updatedAt).toBe(originalUpdatedAt);
      expect(invalidResponse.weekly?.usedPercent).toBe(15);
      expect(invalidResponse.fiveHour).toBeNull();
      expect(invalidResponse.errorReason).toContain("無效配額視窗");

      // 2. 遭遇 401
      globalThis.fetch = async () => new Response("Unauthorized", { status: 401 });
      const stale401 = await client.getQuotaSnapshot(true);
      expect(stale401.source).toBe("cache");
      expect(stale401.updatedAt).toBe(originalUpdatedAt);
      expect(stale401.email).toBe("test@example.com");
      expect(stale401.errorReason).toContain("401");

      // 2.5 隨後呼叫普通 getQuotaSnapshot(false)，必須返回已更新為 cache 的記憶體快照而非舊 wham
      const cachedNormal = await client.getQuotaSnapshot(false);
      expect(cachedNormal.source).toBe("cache");
      expect(cachedNormal.updatedAt).toBe(originalUpdatedAt);
      expect(cachedNormal.email).toBe("test@example.com");
      expect(cachedNormal.errorReason).toContain("401");

      // 3. 遭遇連線失敗 (throw)
      globalThis.fetch = async () => { throw new Error("mock network failure"); };
      const staleNetwork = await client.getQuotaSnapshot(true);
      expect(staleNetwork.source).toBe("cache");
      expect(staleNetwork.updatedAt).toBe(originalUpdatedAt);
      expect(staleNetwork.errorReason).toContain("mock network failure");

      // 4. auth.json 遺失 / 無憑證
      rmSync(authPath, { force: true });
      const staleNoAuth = await client.getQuotaSnapshot(true);
      expect(staleNoAuth.source).toBe("cache");
      expect(staleNoAuth.updatedAt).toBe(originalUpdatedAt);
      expect(staleNoAuth.errorReason).toContain("auth.json");
    } finally {
      globalThis.fetch = originalFetch;
      try {
        rmSync(scratchDir, { recursive: true, force: true });
      } catch {}
    }
  });
});
