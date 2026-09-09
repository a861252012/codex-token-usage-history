import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { QuotaClient } from "../core/quota-client.js";
import { HistoryDatabase } from "../core/history-db.js";
import { SessionIndexer } from "../core/session-indexer.js";
import { SessionWatcher } from "../core/session-watcher.js";
import type { TokenRecord, QuotaSnapshot } from "../core/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export interface ServerOptions {
  port?: number;
  host?: string;
}

export class DashboardServer {
  private port: number;
  private host: string;
  private db: HistoryDatabase;
  private quotaClient: QuotaClient;
  private indexer: SessionIndexer;
  private watcher: SessionWatcher;
  private sseClients = new Set<ServerResponse>();
  private server: ReturnType<typeof createServer> | null = null;

  constructor(db: HistoryDatabase, options: ServerOptions = {}) {
    this.port = options.port ?? 10200;
    this.host = options.host ?? "127.0.0.1";
    this.db = db;
    this.quotaClient = new QuotaClient();
    this.indexer = new SessionIndexer(db);
    this.watcher = new SessionWatcher(this.indexer, this.quotaClient);

    // 監聽並廣播至所有 SSE 客戶端
    this.watcher.on("quotaUpdated", (snap: QuotaSnapshot) => {
      this.broadcastSse("quota", snap);
    });

    this.watcher.on("newRecords", (records: TokenRecord[]) => {
      this.broadcastSse("records", records);
    });
  }

  private broadcastSse(event: string, data: any): void {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(payload);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  public async start(): Promise<string> {
    await this.db.init();
    this.indexer.indexRecent(3);
    this.watcher.start(40_000);

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((err) => {
          res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
          res.end(JSON.stringify({ error: err.message || "伺服器內部錯誤" }));
        });
      });

      this.server.on("error", reject);
      this.server.listen(this.port, this.host, () => {
        const url = `http://${this.host}:${this.port}`;
        resolve(url);
      });
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const pathname = parsedUrl.pathname;

    // CORS 標頭
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // 1. API: 配額狀態
    if (pathname === "/api/quota") {
      const force = parsedUrl.searchParams.get("force") === "true";
      const snap = await this.quotaClient.getQuotaSnapshot(force);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(snap));
      return;
    }

    // 2. API: 消耗歷史清單
    if (pathname === "/api/history") {
      const limit = parseInt(parsedUrl.searchParams.get("limit") || "50", 10);
      const offset = parseInt(parsedUrl.searchParams.get("offset") || "0", 10);
      const model = parsedUrl.searchParams.get("model") || undefined;
      const sinceMs = parsedUrl.searchParams.get("since") ? parseInt(parsedUrl.searchParams.get("since")!, 10) : undefined;

      const data = this.db.queryRecords({ limit, offset, model, sinceMs });
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(data));
      return;
    }

    // 3. API: 彙總統計
    if (pathname === "/api/summary") {
      const sinceMs = parsedUrl.searchParams.get("since") ? parseInt(parsedUrl.searchParams.get("since")!, 10) : undefined;
      const summary = this.db.getSummary(sinceMs);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(summary));
      return;
    }

    // 4. API: 每小時統計
    if (pathname === "/api/stats/hourly") {
      const hours = parseInt(parsedUrl.searchParams.get("hours") || "24", 10);
      const stats = this.db.getHourlyStats(hours);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(stats));
      return;
    }

    // 5. API: 每日統計
    if (pathname === "/api/stats/daily") {
      const days = parseInt(parsedUrl.searchParams.get("days") || "14", 10);
      const stats = this.db.getDailyStats(days);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(stats));
      return;
    }

    // 6. API: Server-Sent Events 即時串流
    if (pathname === "/api/stream") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write("\n");
      this.sseClients.add(res);

      // 初次連線立即推播一次配額
      this.quotaClient.getQuotaSnapshot().then((snap) => {
        res.write(`event: quota\ndata: ${JSON.stringify(snap)}\n\n`);
      });

      req.on("close", () => {
        this.sseClients.delete(res);
      });
      return;
    }

    // 7. 靜態檔案服務 (Web 儀表板)
    let filePath = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    const staticDir = join(__dirname, "../web");
    const absolutePath = join(staticDir, filePath);

    if (existsSync(absolutePath)) {
      const ext = filePath.split(".").pop();
      const contentTypes: Record<string, string> = {
        html: "text/html; charset=utf-8",
        css: "text/css; charset=utf-8",
        js: "application/javascript; charset=utf-8",
        json: "application/json; charset=utf-8",
        svg: "image/svg+xml",
      };
      const contentType = (ext && contentTypes[ext]) || "text/plain";
      const content = readFileSync(absolutePath);
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content);
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: "找不到指定的頁面或端點" }));
  }

  public stop(): void {
    this.watcher.stop();
    for (const res of this.sseClients) {
      try {
        res.end();
      } catch {}
    }
    this.sseClients.clear();
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }
}
