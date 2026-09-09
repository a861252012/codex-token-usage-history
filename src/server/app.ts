import { createServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { QuotaClient } from "../core/quota-client.js";
import { HistoryDatabase } from "../core/history-db.js";
import { SessionIndexer } from "../core/session-indexer.js";
import { SessionWatcher } from "../core/session-watcher.js";
import type { QuotaSnapshot, TokenRecord } from "../core/types.js";

const currentModuleFilePath = fileURLToPath(import.meta.url);
const currentModuleDirectoryPath = join(currentModuleFilePath, "..");

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

  constructor(database: HistoryDatabase, options: DashboardServerOptions = {}) {
    this.portNumber = options.port ?? 10200;
    this.hostAddress = options.host ?? "127.0.0.1";
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

    return new Promise((resolve, reject) => {
      this.serverInstance = createServer((incomingRequest, serverResponse) => {
        this.handleHttpRequest(incomingRequest, serverResponse).catch((handlingError) => {
          serverResponse.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          serverResponse.end(JSON.stringify({ error: handlingError.message }));
        });
      });

      this.serverInstance.on("error", (networkError) => {
        reject(networkError);
      });

      this.serverInstance.listen(this.portNumber, this.hostAddress, () => {
        resolve(`http://${this.hostAddress}:${this.portNumber}`);
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
    const parsedUrl = new URL(incomingRequest.url || "/", `http://${this.hostAddress}:${this.portNumber}`);
    const pathname = parsedUrl.pathname;

    // 設定跨來源資源共用 (CORS) 標頭
    serverResponse.setHeader("Access-Control-Allow-Origin", "*");
    serverResponse.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    serverResponse.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (incomingRequest.method === "OPTIONS") {
      serverResponse.writeHead(204);
      serverResponse.end();
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

      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify({
        snapshot: quotaSnapshot,
        todaySummary,
        recentRecords,
        recentPlanChanges,
      }));
      return;
    }

    // 3. API: 消耗歷史清單
    if (pathname === "/api/history") {
      const limit = parseInt(parsedUrl.searchParams.get("limit") || "50", 10);
      const offset = parseInt(parsedUrl.searchParams.get("offset") || "0", 10);
      const model = parsedUrl.searchParams.get("model") || undefined;
      const role = parsedUrl.searchParams.get("role") || undefined;
      const sinceTimestampMs = parsedUrl.searchParams.get("since")
        ? parseInt(parsedUrl.searchParams.get("since")!, 10)
        : undefined;

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
      const sinceTimestampMs = parsedUrl.searchParams.get("since")
        ? parseInt(parsedUrl.searchParams.get("since")!, 10)
        : undefined;
      const usageSummary = this.databaseInstance.getSummary(sinceTimestampMs);
      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify(usageSummary));
      return;
    }

    // 5. API: 每小時燃燒趨勢統計 (24小時)
    if (pathname === "/api/stats/hourly") {
      const hours = parseInt(parsedUrl.searchParams.get("hours") || "24", 10);
      const hourlyStats = this.databaseInstance.getHourlyStats(hours);
      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify(hourlyStats));
      return;
    }

    // 6. API: 多週期結算報表 (每日、每週、每月、每年)
    if (pathname === "/api/settlement") {
      const periodType = (parsedUrl.searchParams.get("period") || "daily") as "daily" | "weekly" | "monthly" | "yearly";
      const limitCount = parseInt(parsedUrl.searchParams.get("limit") || "30", 10);
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
      const limitCount = parseInt(parsedUrl.searchParams.get("limit") || "20", 10);
      const resetEvents = this.databaseInstance.getResetEvents(limitCount);

      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify(resetEvents));
      return;
    }

    // 8. API: OpenAI 帳號方案變更歷史 (升級/降級歷程)
    if (pathname === "/api/plan-changes") {
      const limitCount = parseInt(parsedUrl.searchParams.get("limit") || "20", 10);
      const planChanges = this.databaseInstance.getPlanChangeEvents(limitCount);

      serverResponse.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      serverResponse.end(JSON.stringify(planChanges));
      return;
    }

    // 8. API: Server-Sent Events 即時串流
    if (pathname === "/api/stream") {
      serverResponse.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      serverResponse.write("\n");
      this.serverSentEventClients.add(serverResponse);

      // 剛連線時主動推送一次最新快照
      this.quotaClient.getQuotaSnapshot().then((snapshot) => {
        serverResponse.write(`event: quota\ndata: ${JSON.stringify(snapshot)}\n\n`);
      });

      incomingRequest.on("close", () => {
        this.serverSentEventClients.delete(serverResponse);
      });
      return;
    }

    // 9. 靜態檔案服務 (Web 儀表板)
    let relativeFilePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    const staticDirectory = join(currentModuleDirectoryPath, "../web");
    const absoluteFilePath = join(staticDirectory, relativeFilePath);

    // 簡易路徑安全檢查 (避免 Directory Traversal)
    if (!absoluteFilePath.startsWith(staticDirectory) || !existsSync(absoluteFilePath)) {
      serverResponse.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      serverResponse.end("找不到指定的靜態檔案");
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
    serverResponse.writeHead(200, { "Content-Type": contentType });
    serverResponse.end(fileBuffer);
  }
}
