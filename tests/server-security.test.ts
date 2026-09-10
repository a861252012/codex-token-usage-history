import { afterEach, describe, expect, test } from "bun:test";
import { request } from "node:http";
import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync, symlinkSync, unlinkSync } from "node:fs";
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

function sendRequest(port: number, headers: Record<string, string> = {}, method = "GET", path = "/api/history?limit=1"): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const outgoingRequest = request({ hostname: "127.0.0.1", port, path, method, headers }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      if (path === "/api/stream") {
        resolve({ status: response.statusCode ?? 0, headers: response.headers, body: "" });
        response.destroy();
        return;
      }
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

      for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
        const alias = await sendRequest(port, { Host: `${host}:${port}`, Origin: `http://${host}:${port}` });
        expect(alias.status).toBe(200);
      }
      for (const host of [`localhost:${port + 1}`, `127.0.0.1.attacker.example:${port}`, `user@localhost:${port}`]) {
        expect((await sendRequest(port, { Host: host })).status).toBe(421);
      }
      expect((await sendRequest(port, { Host: `localhost:${port}`, Origin: serverUrl })).status).toBe(403);
      const stream = await sendRequest(port, {}, "GET", "/api/stream");
      expect(stream.status).toBe(200);
      expect(stream.headers["cache-control"]).toBe("no-cache, no-store");

      const originalQuery = database.queryRecords.bind(database);
      let requestedLimit: number | undefined;
      database.queryRecords = (filters) => {
        requestedLimit = filters.limit;
        return originalQuery(filters);
      };
      for (const [input, expected] of [["5001", 5000], ["5000", 5000], ["7", 7], ["bad", 50], ["0", 50], ["-1", 50], ["1.5", 50]]) {
        expect((await sendRequest(port, {}, "GET", `/api/history?limit=${input}`)).status).toBe(200);
        expect(requestedLimit).toBe(expected);
      }
      const originalHourly = database.getHourlyStats.bind(database);
      let requestedHours: number | undefined;
      database.getHourlyStats = (hours) => {
        requestedHours = hours;
        return originalHourly(hours);
      };
      for (const [input, expected] of [["745", 744], ["48", 48], ["bad", 24]]) {
        expect((await sendRequest(port, {}, "GET", `/api/stats/hourly?hours=${input}`)).status).toBe(200);
        expect(requestedHours).toBe(expected);
      }

      const post = await sendRequest(port, {}, "POST");
      expect(post.status).toBe(405);
    } finally {
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });
  test("does not follow static-file symlinks outside the web root", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-dashboard-symlink-"));
    temporaryDirectories.push(directory);
    writeFileSync(join(directory, "pricing_cache.json"), JSON.stringify({ updatedAtMs: Date.now(), updatedDate: "test", models: [] }));
    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = directory;
    const linkName = `.security-test-${process.pid}-${Date.now()}`;
    const linkPath = join(import.meta.dir, "../src/web", linkName);
    const outsideFile = join(directory, "private-fixture.txt");
    writeFileSync(outsideFile, "isolated-private-fixture");

    try {
      const database = new HistoryDatabase(join(directory, "history.sqlite"));
      const server = new DashboardServer(database, { port: 0 });
      runningServers.push(server);
      const port = Number(new URL(await server.start()).port);
      symlinkSync(outsideFile, linkPath);
      const response = await sendRequest(port, {}, "GET", `/${linkName}`);
      expect(response.status).toBe(404);
      expect(response.body).not.toContain("isolated-private-fixture");
    } finally {
      try { unlinkSync(linkPath); } catch {}
      if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
      else process.env.CODEX_HOME = previousCodexHome;
    }
  });
});
