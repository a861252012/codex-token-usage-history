import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DashboardServer } from "../src/server/app.js";
import { HistoryDatabase } from "../src/core/history-db.js";

test("status identifies its canonical profile and diagnostics stays responsive while quota is pending", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-server-profile-"));
  const directory = join(root, "data");
  const alias = join(root, "alias");
  mkdirSync(directory);
  symlinkSync(directory, alias);
  writeFileSync(join(directory, "pricing_cache.json"), JSON.stringify({ schemaVersion: 2, updatedAtMs: Date.now(), updatedDate: "test", modelCount: 0, models: [] }));
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = alias;
  const database = new HistoryDatabase(join(directory, "history.sqlite"));
  const server = new DashboardServer(database, { port: 0 });
  try {
    const url = await server.start();
    const response = await fetch(`${url}/api/status`);
    expect(response.status).toBe(200);
    const status = await response.json() as Record<string, unknown>;
    expect(status.dataDirectory).toBe(realpathSync(directory));
    expect(status).toHaveProperty("snapshot");
    expect(status).toHaveProperty("todaySummary");
    expect(status).toHaveProperty("recentRecords");
    let releaseQuota!: (value: unknown) => void;
    let markQuotaStarted!: () => void;
    const quotaStarted = new Promise<void>((resolve) => { markQuotaStarted = resolve; });
    const pendingQuota = new Promise((resolve) => { releaseQuota = resolve; });
    (server as any).quotaClient.getQuotaSnapshot = () => { markQuotaStarted(); return pendingQuota; };
    const pendingStatus = fetch(`${url}/api/status`);
    try {
      await quotaStarted;
      const diagnosticsResponse = await fetch(`${url}/api/diagnostics`, { signal: AbortSignal.timeout(1000) });
      expect(diagnosticsResponse.status).toBe(200);
      const diagnostics = await diagnosticsResponse.json() as { dataDirectory: string };
      expect(realpathSync(diagnostics.dataDirectory)).toBe(realpathSync(directory));
    } finally {
      releaseQuota(status.snapshot);
      await pendingStatus;
    }
  } finally {
    server.stop();
    database.close();
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    rmSync(root, { recursive: true, force: true });
  }
});
