import { expect, test } from "bun:test";
import { HistoryDatabase } from "../src/core/history-db.js";
import { QuotaClient } from "../src/core/quota-client.js";

test("missing windows or credits do not create fictional reset or credit-consumed events", async () => {
  const database = new HistoryDatabase(":memory:");
  await database.init();
  const client = new QuotaClient("/nonexistent-codex-fixture", database);
  const window = (used: number, seconds: number) => ({ used_percent: used, limit_window_seconds: seconds, reset_after_seconds: 3600 });
  const before = client.parseWhamResponse({ rate_limit: { primary_window: window(50, 18000), secondary_window: window(30, 604800) }, rate_limit_reset_credits: { available_count: 2 } });
  try {
    for (const payload of [
      { rate_limit: { secondary_window: window(35, 604800) }, rate_limit_reset_credits: { available_count: 2 } },
      { rate_limit: { primary_window: window(50, 18000), secondary_window: window(35, 604800) } },
    ]) {
      (client as any).cachedSnapshot = before;
      (client as any).detectAndRecordResetEvents(client.parseWhamResponse(payload));
      expect(database.getResetEvents(10)).toHaveLength(0);
    }
    const explicitZero = client.parseWhamResponse({ rate_limit: { primary_window: window(50, 18000), secondary_window: window(35, 604800) }, rate_limit_reset_credits: { available_count: 0 } });
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
