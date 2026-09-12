import { expect, test } from "bun:test";
import { HistoryDatabase } from "../src/core/history-db.js";
import { QuotaClient } from "../src/core/quota-client.js";

test("missing windows or credits do not create fictional reset or credit-consumed events", async () => {
  const database = new HistoryDatabase(":memory:");
  await database.init();
  const client = new QuotaClient("/nonexistent-codex-fixture", database);
  const window = (used: number, seconds: number) => ({ used_percent: used, limit_window_seconds: seconds, reset_after_seconds: 3600 });
  const before = client.parseWhamResponse({ account_id: "test-account", rate_limit: { primary_window: window(50, 18000), secondary_window: window(30, 604800) }, rate_limit_reset_credits: { available_count: 2 } });
  try {
    for (const payload of [
      { rate_limit: { secondary_window: window(35, 604800) }, rate_limit_reset_credits: { available_count: 2 } },
      { rate_limit: { primary_window: window(50, 18000), secondary_window: window(35, 604800) } },
    ]) {
      (client as any).cachedSnapshot = before;
      (client as any).detectAndRecordResetEvents(client.parseWhamResponse({ account_id: "test-account", ...payload }));
      expect(database.getResetEvents(10)).toHaveLength(0);
    }
    const explicitZero = client.parseWhamResponse({ account_id: "test-account", rate_limit: { primary_window: window(50, 18000), secondary_window: window(35, 604800) }, rate_limit_reset_credits: { available_count: 0 } });
    expect(explicitZero.resetCreditsKnown).toBe(true);
    (client as any).cachedSnapshot = before;
    (client as any).detectAndRecordResetEvents(explicitZero);
    expect(database.getResetEvents(10)).toHaveLength(1);
    expect(database.getResetEvents(10)[0].creditDelta).toBe(-2);
  } finally { database.close(); }
});

for (const scenario of [
  { name: "unknown credits with elapsed windows", before: undefined, after: undefined, elapsed: true, resets: 2, credits: 0 },
  { name: "unknown credits without elapsed windows", before: undefined, after: undefined, elapsed: false, resets: 0, credits: 0 },
  { name: "credits received alongside a reset", before: 1, after: 2, elapsed: true, resets: 2, credits: 1 },
  { name: "unchanged credits without elapsed window", before: 1, after: 1, elapsed: false, resets: 0, credits: 0 },
  { name: "consumed credits", before: 2, after: 1, elapsed: true, resets: 0, credits: 1 },
  { name: "plan changed", before: 1, after: 1, elapsed: true, resets: 0, credits: 0, newPlan: "pro" },
]) {
  test(`reset evidence: ${scenario.name}`, async () => {
    const database = new HistoryDatabase(":memory:");
    await database.init();
    try {
      const client = new QuotaClient("/nonexistent-codex-fixture", database);
      const now = Math.floor(Date.now() / 1000);
      const snapshot = (used: number, credits: number | undefined, resetAt: number, plan = "plus") => client.parseWhamResponse({
        account_id: "test-account",
        plan_type: plan,
        rate_limit: {
          primary_window: { used_percent: used, limit_window_seconds: 18000, reset_at: resetAt },
          secondary_window: { used_percent: used, limit_window_seconds: 604800, reset_at: resetAt },
        },
        ...(credits === undefined ? {} : { rate_limit_reset_credits: { available_count: credits } }),
      });
      (client as any).cachedSnapshot = snapshot(80, scenario.before, scenario.elapsed ? now - 60 : now + 3600);
      (client as any).detectAndRecordResetEvents(snapshot(5, scenario.after, now + 3600, scenario.newPlan));
      const events = database.getResetEvents(10);
      expect(events.filter((event) => event.eventType === "periodic_reset")).toHaveLength(scenario.resets);
      expect(events.filter((event) => event.eventType !== "periodic_reset")).toHaveLength(scenario.credits);
    } finally { database.close(); }
  });
}

test("legacy usage drops do not claim a periodic reset, including concurrent upgrades", async () => {
  const database = new HistoryDatabase(":memory:");
  await database.init();
  try {
    const timestamp = Date.now();
    database.insertResetEvent({ timestamp, datetime: new Date(timestamp).toISOString(),
      eventType: "periodic_reset", previousFiveHourUsedPercent: 0, newFiveHourUsedPercent: 0,
      previousWeeklyUsedPercent: 87, newWeeklyUsedPercent: 0, availableCredits: 1,
      creditDelta: 0, description: "週用量時間視窗滾動重置（使用率自 87.0% 降至 0.0%）" });
    expect(database.getResetEvents()[0].eventType).toBe("usage_drop");
    expect(database.getResetEvents()[0].description).toContain("缺少週期到期證據");
    database.insertPlanChangeEvent({ timestamp: timestamp + 1, datetime: new Date(timestamp).toISOString(),
      previousPlan: "prolite", newPlan: "pro", changeType: "upgrade", description: "方案升級" });
    expect(database.getResetEvents()[0].description).toContain("同時間有方案變更");
    expect(database.getResetEvents()[0].previousWeeklyUsedPercent).toBe(87);
  } finally { database.close(); }
});
