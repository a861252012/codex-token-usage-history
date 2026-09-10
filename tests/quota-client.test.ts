import { describe, test, expect } from "bun:test";
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
    expect(snapshot.fiveHour?.usedPercent).toBe(0);
    expect(snapshot.fiveHour?.resetAfterSeconds).toBe(0);
    expect(snapshot.resetCredits).toBe(0);
    expect(snapshot.additionalLimits).toHaveLength(100);
  });
});
