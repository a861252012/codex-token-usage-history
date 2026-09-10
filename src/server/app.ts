import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync, existsSync, realpathSync, statSync } from "node:fs";
import { join, extname, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { QuotaClient } from "../core/quota-client.js";
import { HistoryDatabase } from "../core/history-db.js";
import { SessionIndexer } from "../core/session-indexer.js";
import { SessionWatcher } from "../core/session-watcher.js";
import {
  getActivePricingConfig,
  getEffectiveCatalogOverview,
} from "../core/pricing-calculator.js";
import { triggerBackgroundPricingSync } from "../core/pricing-sync.js";
import type { QuotaSnapshot, TokenRecord } from "../core/types.js";

let cachedWebStaticDirectoryPath: string | null = null;

function resolveWebStaticDirectoryPath(): string {
  if (cachedWebStaticDirectoryPath !== null) {
    return cachedWebStaticDirectoryPath;
  }

  const currentModuleFilePath = fileURLToPath(import.meta.url);
  const moduleDirectoryPath = join(currentModuleFilePath, "..");
  const candidateDirectoryPaths = [
    join(moduleDirectoryPath, "../web"),
    join(moduleDirectoryPath, "../../src/web"),
    join(moduleDirectoryPath, "../../web"),
  ];

  for (const candidateDirectoryPath of candidateDirectoryPaths) {
    if (existsSync(join(candidateDirectoryPath, "index.html"))) {
      cachedWebStaticDirectoryPath = resolve(candidateDirectoryPath);
      return cachedWebStaticDirectoryPath;
    }
  }

  cachedWebStaticDirectoryPath = resolve(candidateDirectoryPaths[0]);
  return cachedWebStaticDirectoryPath;
}

const MAXIMUM_API_RECORD_LIMIT = 5_000;
const MAXIMUM_HOURLY_RANGE = 24 * 31;

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.$/, "");
}

function isLoopbackHostAddress(hostAddress: string): boolean {
  const normalizedHost = normalizeHostname(hostAddress);
  return normalizedHost === "127.0.0.1" || normalizedHost === "localhost" || normalizedHost === "::1";
}

function formatHostForUrl(hostAddress: string): string {
  return normalizeHostname(hostAddress).includes(":") ? `[${normalizeHostname(hostAddress)}]` : normalizeHostname(hostAddress);
}

function parseBoundedInteger(rawValue: string | null, defaultValue: number, minimum: number, maximum: number): number {
  if (rawValue === null || !/^\d+$/.test(rawValue)) return defaultValue;
  const parsedValue = Number(rawValue);
  return Number.isSafeInteger(parsedValue) && parsedValue >= minimum
    ? Math.min(parsedValue, maximum)
    : defaultValue;
}

function parseOptionalTimestamp(rawValue: string | null): number | undefined {
  if (rawValue === null || !/^\d+$/.test(rawValue)) return undefined;
  const parsedValue = Number(rawValue);
  return Number.isSafeInteger(parsedValue) && parsedValue >= 0 ? parsedValue : undefined;
}

export interface DashboardServerOptions {
  port?: number;
  host?: string;
}

export class DashboardServer {
  private serverInstance: Server | null = null;
  private portNumber: number;
  private hostAddress: string;
  private databaseInstance: HistoryDatabase;
  private quotaClient: QuotaClient;
  private sessionIndexer: SessionIndexer;
  private sessionWatcher: SessionWatcher;
  private serverSentEventClients: Set<ServerResponse> = new Set();
  private staticFileCache = new Map<string, { buffer: Buffer; contentType: string }>();

  constructor(database: HistoryDatabase, options: DashboardServerOptions = {}) {
    this.portNumber = options.port ?? 10200;
    this.hostAddress = options.host ?? "127.0.0.1";
    if (!Number.isInteger(this.portNumber) || this.portNumber < 0 || this.portNumber > 65_535) {
      throw new Error("Dashboard port must be an integer between 0 and 65535");
    }
    if (!isLoopbackHostAddress(this.hostAddress)) {
      throw new Error("For security, the dashboard may only listen on a loopback address");
    }
    this.databaseInstance = database;
    this.quotaClient = new QuotaClient(undefined, this.databaseInstance);
    this.sessionIndexer = new SessionIndexer(database);
    this.sessionWatcher = new SessionWatcher(this.sessionIndexer, this.quotaClient);

    // 監聽並廣播至所有 SSE 用戶端
    this.sessionWatcher.on("quotaUpdated", (snapshot: QuotaSnapshot) => {
      this.broadcastServerSentEvent("quota", snapshot);
    });

    this.sessionWatcher.on("newRecords", (records: TokenRecord[]) => {
      this.broadcastServerSentEvent("records", records);
    });
  }

  public async start(): Promise<string> {
    await this.databaseInstance.init();
    await this.sessionWatcher.start();
    triggerBackgroundPricingSync();

    return new Promise((resolve, reject) => {
      this.serverInstance = createServer((incomingRequest, serverResponse) => {
        this.handleHttpRequest(incomingRequest, serverResponse).catch((handlingError) => {
          console.error("[dashboard] Request handling failed:", handlingError);
          if (serverResponse.headersSent) {
            serverResponse.end();
            return;
          }
          serverResponse.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          serverResponse.end(JSON.stringify({ error: "Internal server error" }));
        });
      });

      this.serverInstance.once("error", (networkError) => {
        this.sessionWatcher.stop();
        reject(networkError);
      });

      this.serverInstance.listen(this.portNumber, this.hostAddress, () => {
        const listeningAddress = this.serverInstance?.address() as AddressInfo | null;
        if (listeningAddress) this.portNumber = listeningAddress.port;
        resolve(`http://${formatHostForUrl(this.hostAddress)}:${this.portNumber}`);
      });
    });
  }

  public stop(): void {
    this.sessionWatcher.stop();
    for (const clientResponse of this.serverSentEventClients) {
      try {
        clientResponse.end();
      } catch {
        // 忽略關閉連線例外
      }
    }
    this.serverSentEventClients.clear();

    if (this.serverInstance) {
      this.serverInstance.close();
      this.serverInstance = null;
    }
  }

  private broadcastServerSentEvent(eventType: string, eventData: any): void {
    const payload = `event: ${eventType}\ndata: ${JSON.stringify(eventData)}\n\n`;
    for (const clientResponse of this.serverSentEventClients) {
      try {
        clientResponse.write(payload);
      } catch {
        this.serverSentEventClients.delete(clientResponse);
      }
    }
  }

  private async handleHttpRequest(incomingRequest: IncomingMessage, serverResponse: ServerResponse): Promise<void> {
    const serverOrigin = `http://${formatHostForUrl(this.hostAddress)}:${this.portNumber}`;
    const parsedUrl = new URL(incomingRequest.url || "/", serverOrigin);
    const pathname = parsedUrl.pathname;

    serverResponse.setHeader("X-Content-Type-Options", "nosniff");
    serverResponse.setHeader("X-Frame-Options", "DENY");
    serverResponse.setHeader("Referrer-Policy", "no-referrer");
    serverResponse.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");

    // A browser can otherwise use DNS rebinding or permissive CORS to read local
    // account and usage data. The dashboard is intentionally same-origin only.
    const requestHost = incomingRequest.headers.host;
    const allowedHosts = ["127.0.0.1", "localhost", "[::1]"].map(
      (host) => new URL(`http://${host}:${this.portNumber}`).host,
    );
    if (!requestHost || !allowedHosts.includes(requestHost.toLowerCase())) {
      serverResponse.writeHead(421, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify({ error: "Misdirected request" }));
      return;
    }

    const requestOrigin = incomingRequest.headers.origin;
    if (requestOrigin) {
      let originHost: string | null = null;
      try {
        const originUrl = new URL(requestOrigin);
        originHost = originUrl.protocol === "http:" ? originUrl.host.toLowerCase() : null;
      } catch {
        originHost = null;
      }
      if (originHost !== requestHost.toLowerCase()) {
        serverResponse.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
        serverResponse.end(JSON.stringify({ error: "Cross-origin requests are not allowed" }));
        return;
      }
    }

    const fetchSite = incomingRequest.headers["sec-fetch-site"];
    if (fetchSite === "cross-site") {
      serverResponse.writeHead(403, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify({ error: "Cross-site requests are not allowed" }));
      return;
    }

    if (incomingRequest.method === "OPTIONS") {
      serverResponse.setHeader("Allow", "GET, HEAD, OPTIONS");
      serverResponse.writeHead(204);
      serverResponse.end();
      return;
    }

    if (incomingRequest.method !== "GET" && incomingRequest.method !== "HEAD") {
      serverResponse.setHeader("Allow", "GET, HEAD, OPTIONS");
      serverResponse.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    if (pathname.startsWith("/api/")) {
      serverResponse.setHeader("Cache-Control", "no-store");
    }

    if (pathname === "/api/diagnostics") {
      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify(this.sessionIndexer.getDiagnostics()));
      return;
    }

    // 1. API: 即時配額狀態
    if (pathname === "/api/quota") {
      const forceRefresh = parsedUrl.searchParams.get("force") === "true";
      const quotaSnapshot = await this.quotaClient.getQuotaSnapshot(forceRefresh);
      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify(quotaSnapshot));
      return;
    }

    // 2. API: 一站式狀態聚合端點 (包含配額、今日統計與近期紀錄)
    if (pathname === "/api/status") {
      const forceRefresh = parsedUrl.searchParams.get("force") === "true";
      const quotaSnapshot = await this.quotaClient.getQuotaSnapshot(forceRefresh);

      const todayMidnight = new Date();
      todayMidnight.setHours(0, 0, 0, 0);
      const todaySummary = this.databaseInstance.getSummary(todayMidnight.getTime());
      const { records: recentRecords } = this.databaseInstance.queryRecords({ limit: 5 });
      const recentPlanChanges = this.databaseInstance.getPlanChangeEvents(5);

      const pricingConfig = getActivePricingConfig();

      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify({
        snapshot: quotaSnapshot,
        todaySummary,
        recentRecords,
        recentPlanChanges,
        pricing: {
          version: pricingConfig.pricingVersion,
          source: pricingConfig.pricingSource,
        },
      }));
      return;
    }

    // 3. API: 消耗歷史清單
    if (pathname === "/api/history") {
      const limit = parseBoundedInteger(parsedUrl.searchParams.get("limit"), 50, 1, MAXIMUM_API_RECORD_LIMIT);
      const offset = parseBoundedInteger(parsedUrl.searchParams.get("offset"), 0, 0, Number.MAX_SAFE_INTEGER);
      const model = parsedUrl.searchParams.get("model") || undefined;
      const role = parsedUrl.searchParams.get("role") || parsedUrl.searchParams.get("agent_role") || undefined;
      if (role !== undefined && role !== "main" && role !== "subagent" && role !== "unknown") {
        serverResponse.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        serverResponse.end(JSON.stringify({ error: "agent_role must be main, subagent or unknown" }));
        return;
      }
      const sinceTimestampMs = parseOptionalTimestamp(parsedUrl.searchParams.get("since"));

      const historyData = this.databaseInstance.queryRecords({
        limit,
        offset,
        model,
        agentRole: role,
        sinceMs: sinceTimestampMs,
      });
      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify(historyData));
      return;
    }

    // 4. API: 彙總統計
    if (pathname === "/api/summary") {
      const sinceTimestampMs = parseOptionalTimestamp(parsedUrl.searchParams.get("since"));
      const usageSummary = this.databaseInstance.getSummary(sinceTimestampMs);
      const pricingConfig = getActivePricingConfig();
      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify({
        ...usageSummary,
        pricing: {
          version: pricingConfig.pricingVersion,
          source: pricingConfig.pricingSource,
        },
      }));
      return;
    }

    // 5. API: 每小時燃燒趨勢統計 (24小時)
    if (pathname === "/api/stats/hourly") {
      const hours = parseBoundedInteger(parsedUrl.searchParams.get("hours"), 24, 1, MAXIMUM_HOURLY_RANGE);
      const hourlyStats = this.databaseInstance.getHourlyStats(hours);
      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify(hourlyStats));
      return;
    }

    // 6. API: 多週期結算報表 (每日、每週、每月、每年)
    if (pathname === "/api/settlement") {
      const requestedPeriod = parsedUrl.searchParams.get("period");
      const periodType = requestedPeriod === "weekly" || requestedPeriod === "monthly" || requestedPeriod === "yearly"
        ? requestedPeriod
        : "daily";
      const limitCount = parseBoundedInteger(parsedUrl.searchParams.get("limit"), 30, 1, MAXIMUM_API_RECORD_LIMIT);
      const settlementRecords = this.databaseInstance.getSettlementRecords(periodType, limitCount);
      const planChangeEvents = this.databaseInstance.getPlanChangeEvents(10);

      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify({
        settlements: settlementRecords,
        planChanges: planChangeEvents,
      }));
      return;
    }

    // 7. API: OpenAI 配額重置歷史與重置券變動
    if (pathname === "/api/resets") {
      const limitCount = parseBoundedInteger(parsedUrl.searchParams.get("limit"), 20, 1, MAXIMUM_API_RECORD_LIMIT);
      const resetEvents = this.databaseInstance.getResetEvents(limitCount);

      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify(resetEvents));
      return;
    }

    // 8. API: OpenAI 帳號方案變更歷史 (升級/降級歷程)
    if (pathname === "/api/plan-changes") {
      const limitCount = parseBoundedInteger(parsedUrl.searchParams.get("limit"), 20, 1, MAXIMUM_API_RECORD_LIMIT);
      const planChanges = this.databaseInstance.getPlanChangeEvents(limitCount);

      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify(planChanges));
      return;
    }

    // 8.5. API: 取得當前模型定價與各層級決策資訊
    if (pathname === "/api/pricing") {
      const config = getActivePricingConfig();
      const overview = getEffectiveCatalogOverview();
      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify({
        ...config,
        models: overview,
      }));
      return;
    }

    // 8. API: Server-Sent Events 即時串流
    if (pathname === "/api/stream") {
      serverResponse.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-store",
        Connection: "keep-alive",
      });
      serverResponse.write("\n");
      this.serverSentEventClients.add(serverResponse);

      // 剛連線時主動推送一次最新快照
      this.quotaClient.getQuotaSnapshot().then((snapshot) => {
        serverResponse.write(`event: quota\ndata: ${JSON.stringify(snapshot)}\n\n`);
      });

      serverResponse.on("error", () => {
        this.serverSentEventClients.delete(serverResponse);
      });

      incomingRequest.on("close", () => {
        this.serverSentEventClients.delete(serverResponse);
      });
      return;
    }

    // 9. 靜態檔案服務 (Web 儀表板，具備記憶體快取與安全路徑校驗)
    const relativeFilePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    const staticDirectory = realpathSync(resolveWebStaticDirectoryPath());
    const requestedFilePath = resolve(staticDirectory, relativeFilePath);
    let absoluteFilePath: string;
    try {
      absoluteFilePath = realpathSync(requestedFilePath);
    } catch {
      serverResponse.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      serverResponse.end("找不到指定的靜態檔案");
      return;
    }
    const relativePath = relative(staticDirectory, absoluteFilePath);

    if (
      !relativePath
      || relativePath.startsWith("..")
      || relativePath.startsWith(`..${sep}`)
      || isAbsolute(relativePath)
      || !statSync(absoluteFilePath).isFile()
    ) {
      serverResponse.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      serverResponse.end("找不到指定的靜態檔案");
      return;
    }

    const cachedFile = this.staticFileCache.get(absoluteFilePath);
    if (cachedFile) {
      serverResponse.writeHead(200, { "Content-Type": cachedFile.contentType });
      serverResponse.end(cachedFile.buffer);
      return;
    }

    const fileExtension = extname(absoluteFilePath).toLowerCase();
    const mimeTypeMap: Record<string, string> = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png",
    };

    const contentType = mimeTypeMap[fileExtension] || "application/octet-stream";
    const fileBuffer = readFileSync(absoluteFilePath);
    this.staticFileCache.set(absoluteFilePath, { buffer: fileBuffer, contentType });

    serverResponse.writeHead(200, { "Content-Type": contentType });
    serverResponse.end(fileBuffer);
  }
}
