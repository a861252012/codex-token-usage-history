import { afterEach, describe, expect, test } from "bun:test";
import { request } from "node:http";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DashboardServer } from "../src/server/app.js";
import { HistoryDatabase } from "../src/core/history-db.js";

interface HttpResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

const temporaryDirectories: string[] = [];
const runningServers: DashboardServer[] = [];

afterEach(() => {
  for (const server of runningServers.splice(0)) server.stop();
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function sendRequest(port: number, headers: Record<string, string> = {}, method = "GET"): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const outgoingRequest = request({ hostname: "127.0.0.1", port, path: "/api/history?limit=1", method, headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({
        status: response.statusCode ?? 0,
        headers: response.headers,
        body,
      }));
    });
    outgoingRequest.on("error", reject);
    outgoingRequest.end();
  });
}

describe("dashboard HTTP security", () => {
  test("refuses non-loopback listeners", () => {
    const database = new HistoryDatabase(":memory:");
    expect(() => new DashboardServer(database, { host: "0.0.0.0" })).toThrow("loopback");
    expect(() => new DashboardServer(database, { port: -1 })).toThrow("port");
    expect(() => new DashboardServer(database, { port: 1.5 })).toThrow("port");
    expect(() => new DashboardServer(database, { port: 65_536 })).toThrow("port");
  });

  test("blocks DNS rebinding, cross-origin reads, and unsupported methods", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-dashboard-security-"));
    temporaryDirectories.push(directory);
    const quotaCachePath = join(directory, "codex_quota_snapshot.json");
    const pricingCachePath = join(directory, "pricing_cache.json");
    writeFileSync(quotaCachePath, JSON.stringify({ updatedAt: Date.now(), source: "cache" }));
    writeFileSync(pricingCachePath, JSON.stringify({ updatedAtMs: Date.now(), updatedDate: "test", modelCount: 0, models: [] }));
    chmodSync(quotaCachePath, 0o644);
    chmodSync(pricingCachePath, 0o644);

    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = directory;
    try {
      const database = new HistoryDatabase(join(directory, "history.sqlite"));
      const server = new DashboardServer(database, { port: 0 });
      runningServers.push(server);
      const serverUrl = await server.start();
      const port = Number(new URL(serverUrl).port);
      expect(port).toBeGreaterThan(0);
      expect(statSync(join(directory, "history.sqlite")).mode & 0o777).toBe(0o600);
      expect(statSync(quotaCachePath).mode & 0o777).toBe(0o600);
      expect(statSync(pricingCachePath).mode & 0o777).toBe(0o600);

      const valid = await sendRequest(port);
      expect(valid.status).toBe(200);
      expect(valid.headers["access-control-allow-origin"]).toBeUndefined();
      expect(valid.headers["content-security-policy"]).toContain("default-src 'self'");
      expect(valid.headers["x-content-type-options"]).toBe("nosniff");
      expect(valid.headers["x-frame-options"]).toBe("DENY");
      expect(valid.headers["cache-control"]).toBe("no-store");

      const sameOrigin = await sendRequest(port, { Origin: serverUrl });
      expect(sameOrigin.status).toBe(200);

      const rebound = await sendRequest(port, { Host: `attacker.example:${port}` });
      expect(rebound.status).toBe(421);

      const crossOrigin = await sendRequest(port, { Origin: "https://attacker.example" });
      expect(crossOrigin.status).toBe(403);

      const crossSiteNavigation = await sendRequest(port, { "Sec-Fetch-Site": "cross-site" });
      expect(crossSiteNavigation.status).toBe(403);

      const post = await sendRequest(port, {}, "POST");
      expect(post.status).toBe(405);
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });
});
