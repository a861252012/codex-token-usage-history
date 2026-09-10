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
