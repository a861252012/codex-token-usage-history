import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import { HistoryDatabase } from "../src/core/history-db.js";
import { DashboardServer } from "../src/server/app.js";

test("diagnostics API exposes actual scan scope and remains behind HTTP boundaries", async () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-diagnostics-api-"));
  const previousHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = directory;
  mkdirSync(join(directory, "sessions"));
  mkdirSync(join(directory, "archived_sessions"));
  writeFileSync(join(directory, "pricing_cache.json"), JSON.stringify({ schemaVersion: 2, updatedAtMs: Date.now(), updatedDate: "test", modelCount: 0, models: [] }));
  writeFileSync(join(directory, "sessions", "sample.jsonl"), [
    JSON.stringify({ type: "token_usage_record", timestamp: new Date().toISOString(), payload: { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } }),
    "{broken-json",
  ].join("\n"));
  const archivedPath = join(directory, "archived_sessions", "old.jsonl");
  writeFileSync(archivedPath, JSON.stringify({ type: "token_usage_record", timestamp: "2025-01-01T00:00:00Z", payload: { usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 } } }));
  utimesSync(archivedPath, new Date("2025-01-01"), new Date("2025-01-01"));
  const database = new HistoryDatabase(join(directory, "history.sqlite"));
  const server = new DashboardServer(database, { port: 0 });
  try {
    const base = await server.start();
    const get = (headers: Record<string, string> = {}) => new Promise<{ status: number; body: string; cache?: string }>((resolve, reject) => {
      request(`${base}/api/diagnostics`, { headers }, (response) => {
        let body = "";
        response.on("data", (chunk) => body += chunk);
        response.on("end", () => resolve({ status: response.statusCode ?? 0, body, cache: response.headers["cache-control"] }));
      }).on("error", reject).end();
    });
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.cache).toBe("no-store");
    const diagnostics = JSON.parse(response.body);
    expect(diagnostics.dataDirectory).toBe(directory);
    expect(diagnostics.scope).toBe("all");
    expect(diagnostics.recordsParsed).toBe(2);
    expect(diagnostics.invalidLines).toBe(1);
    expect(diagnostics.filesRead).toBe(2);
    const history = await (await fetch(`${base}/api/history`)).json();
    expect(history.total).toBe(2);
    expect((await fetch(`${base}/app.js`)).headers.get("cache-control")).toBe("no-store");
    await fetch(`${base}/`);
    await fetch(`${base}/`);
    expect(database.queryRecords({ limit: 10 }).total).toBe(2);
    expect((await get({ Origin: "https://attacker.example" })).status).toBe(403);
    expect((await get({ Host: "attacker.example" })).status).toBe(421);
  } finally {
    server.stop();
    database.close();
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    rmSync(directory, { recursive: true, force: true });
  }
});
