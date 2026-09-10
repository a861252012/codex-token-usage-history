import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readHudSettings, saveHudSettings } from "../src/core/hud-settings.js";
import { DashboardServer } from "../src/server/app.js";
import { HistoryDatabase } from "../src/core/history-db.js";

test("HUD interval defaults, validation, persistence and same-origin API", async () => {
  const directory = mkdtempSync(join(tmpdir(), "hud-settings-test-"));
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = directory;
  const database = new HistoryDatabase(join(directory, "history.sqlite"));
  const server = new DashboardServer(database, { port: 0 });
  try {
    writeFileSync(join(directory, "pricing_cache.json"), JSON.stringify({ updatedAtMs: Date.now(), updatedDate: "test", modelCount: 0, models: [] }));
    expect(readHudSettings(directory).refreshIntervalSeconds).toBe(5);
    writeFileSync(join(directory, "hud-settings.json"), "broken");
    expect(readHudSettings(directory).refreshIntervalSeconds).toBe(5);
    const url = await server.start();
    const endpoint = `${url}/api/hud-settings`;
    const post = (body: string, headers = { Origin: url, "Content-Type": "application/json" }) =>
      fetch(endpoint, { method: "POST", headers, body });
    for (const value of [1, 5, 300]) {
      expect((await post(JSON.stringify({ refreshIntervalSeconds: value }))).status).toBe(200);
      expect(await (await fetch(endpoint)).json()).toEqual({ refreshIntervalSeconds: value });
      expect(readHudSettings(directory).refreshIntervalSeconds).toBe(value);
    }
    for (const value of [0, -1, 301, 1.5, "5", true, null, [], {}]) {
      expect((await post(JSON.stringify({ refreshIntervalSeconds: value }))).status).toBe(400);
      expect(readHudSettings(directory).refreshIntervalSeconds).toBe(300);
    }
    expect((await post("{")).status).toBe(400);
    expect((await post(" ".repeat(1025))).status).toBe(413);
    expect((await post('{"refreshIntervalSeconds":1}', { Origin: "https://example.com", "Content-Type": "application/json" })).status).toBe(403);
    expect((await post('{"refreshIntervalSeconds":1}', { Origin: url, "Content-Type": "text/plain" })).status).toBe(403);
    expect((await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"refreshIntervalSeconds":1}' })).status).toBe(403);
    expect(() => saveHudSettings(directory, 0)).toThrow();
    expect(readHudSettings(directory).refreshIntervalSeconds).toBe(300);
  } finally {
    server.stop();
    database.close();
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    rmSync(directory, { recursive: true, force: true });
  }
});
