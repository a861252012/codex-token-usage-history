import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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
  writeFileSync(join(directory, "pricing_cache.json"), JSON.stringify({ updatedAtMs: Date.now(), updatedDate: "test", models: [] }));
  writeFileSync(join(directory, "sessions", "sample.jsonl"), [
    JSON.stringify({ type: "token_usage_record", timestamp: new Date().toISOString(), payload: { usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 } } }),
    "{broken-json",
  ].join("\n"));
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
    expect(diagnostics.scope).toBe("recent");
    expect(diagnostics.recordsParsed).toBe(1);
    expect(diagnostics.invalidLines).toBe(1);
    expect(diagnostics.filesRead).toBe(1);
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
