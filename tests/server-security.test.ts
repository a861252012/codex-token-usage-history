import { afterEach, describe, expect, test } from "bun:test";
import { request } from "node:http";
import { mkdtempSync, rmSync, statSync, symlinkSync, unlinkSync } from "node:fs";
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
    expect(() => new DashboardServer(database, { port: 65_536 })).toThrow("port");
  });

  test("blocks DNS rebinding, cross-origin reads, and unsupported methods", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-dashboard-security-"));
    temporaryDirectories.push(directory);
    const database = new HistoryDatabase(join(directory, "history.sqlite"));
    const server = new DashboardServer(database, { port: 0 });
    runningServers.push(server);
    const serverUrl = await server.start();
    const port = Number(new URL(serverUrl).port);
    expect(statSync(join(directory, "history.sqlite")).mode & 0o777).toBe(0o600);

    const valid = await sendRequest(port);
    expect(valid.status).toBe(200);
    expect(valid.headers["access-control-allow-origin"]).toBeUndefined();
    expect(valid.headers["content-security-policy"]).toContain("default-src 'self'");
    expect(valid.headers["cache-control"]).toBe("no-store");

    const rebound = await sendRequest(port, { Host: `attacker.example:${port}` });
    expect(rebound.status).toBe(421);

    const crossOrigin = await sendRequest(port, { Origin: "https://attacker.example" });
    expect(crossOrigin.status).toBe(403);

    const crossSiteNavigation = await sendRequest(port, { "Sec-Fetch-Site": "cross-site" });
    expect(crossSiteNavigation.status).toBe(403);

    const post = await sendRequest(port, {}, "POST");
    expect(post.status).toBe(405);
  });

  test("does not follow static-file symlinks outside the web root", async () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-dashboard-symlink-"));
    temporaryDirectories.push(directory);
    const database = new HistoryDatabase(join(directory, "history.sqlite"));
    const server = new DashboardServer(database, { port: 0 });
    runningServers.push(server);
    const port = Number(new URL(await server.start()).port);
    const linkName = `.security-test-${process.pid}-${Date.now()}`;
    const linkPath = join(import.meta.dir, "../src/web", linkName);

    try {
      symlinkSync("/etc/passwd", linkPath);
      const response = await sendRequest(port, {}, "GET", `/${linkName}`);
      expect(response.status).toBe(404);
      expect(response.body).not.toContain("root:");
    } finally {
      try { unlinkSync(linkPath); } catch {}
    }
  });
});
