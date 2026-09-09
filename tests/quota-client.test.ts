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
});
