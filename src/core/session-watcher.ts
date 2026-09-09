import { watch, type FSWatcher, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { EventEmitter } from "node:events";
import { SessionIndexer } from "./session-indexer.js";
import { QuotaClient } from "./quota-client.js";
import type { TokenRecord, QuotaSnapshot } from "./types.js";

export interface SessionWatcherEvents {
  newRecords: (records: TokenRecord[]) => void;
  quotaUpdated: (snapshot: QuotaSnapshot) => void;
  error: (err: Error) => void;
}

export class SessionWatcher extends EventEmitter {
  private codexHome: string;
  private indexer: SessionIndexer;
  private quotaClient: QuotaClient;
  private watchedDirs = new Map<string, FSWatcher>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private pollInterval: NodeJS.Timeout | null = null;
  private running = false;

  constructor(indexer: SessionIndexer, quotaClient: QuotaClient, codexHomeDir?: string) {
    super();
    this.indexer = indexer;
    this.quotaClient = quotaClient;
    this.codexHome = codexHomeDir || process.env.CODEX_HOME || join(homedir(), ".codex");
  }

  /**
   * 啟動即時檔案監聽與定時配額輪詢
   */
  public start(pollIntervalMs = 45_000): void {
    if (this.running) return;
    this.running = true;

    // 先執行一次近期增量掃描
    try {
      this.indexer.indexRecent(3);
    } catch {}

    // 建立目錄監聽器
    this.setupDateDirWatchers();

    // 定期輪詢今天目錄 (防止 fs.watch 漏掉事件，同時自動維護過期監聽器)
    this.pollInterval = setInterval(async () => {
      try {
        this.setupDateDirWatchers();
        const res = this.indexer.indexRecent(1);
        if (res.recordsInserted > 0) {
          const quota = await this.quotaClient.getQuotaSnapshot(true);
          this.emit("quotaUpdated", quota);
        } else {
          const quota = await this.quotaClient.getQuotaSnapshot(false);
          this.emit("quotaUpdated", quota);
        }
      } catch (err: any) {
        this.emit("error", err);
      }
    }, pollIntervalMs);
  }

  private setupDateDirWatchers(): void {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const year = today.getFullYear();
    const month = pad(today.getMonth() + 1);
    const day = pad(today.getDate());

    const activeDirs = new Set<string>();

    // 今天目錄
    const sessionTodayDir = join(this.codexHome, "sessions", String(year), month, day);
    activeDirs.add(sessionTodayDir);

    // 昨天目錄
    const yesterday = new Date(Date.now() - 86400000);
    const yMonth = pad(yesterday.getMonth() + 1);
    const yDay = pad(yesterday.getDate());
    const sessionYestDir = join(this.codexHome, "sessions", String(yesterday.getFullYear()), yMonth, yDay);
    activeDirs.add(sessionYestDir);

    // 關閉並清理已失效的舊目錄監聽器 (避免記憶體與檔案描述元洩漏)
    for (const [dir, w] of this.watchedDirs.entries()) {
      if (!activeDirs.has(dir)) {
        try {
          w.close();
        } catch {}
        this.watchedDirs.delete(dir);
      }
    }

    // 加入尚未監聽的活躍目錄
    for (const dir of activeDirs) {
      if (!this.watchedDirs.has(dir)) {
        this.watchDir(dir);
      }
    }
  }

  private watchDir(dirPath: string): void {
    if (!existsSync(dirPath)) return;
    if (this.watchedDirs.has(dirPath)) return; // 嚴格防止重複監聽

    try {
      const w = watch(dirPath, (eventType, filename) => {
        if (!filename || !filename.endsWith(".jsonl")) return;
        const fullPath = join(dirPath, filename);

        // 防抖動 250ms 避免檔案正在寫入中重複讀取
        const existingTimer = this.debounceTimers.get(fullPath);
        if (existingTimer) clearTimeout(existingTimer);

        const timer = setTimeout(async () => {
          this.debounceTimers.delete(fullPath);
          try {
            // 單次讀取與解析，消除雙重全檔 I/O
            const { insertedCount, newRecords } = this.indexer.indexFile(fullPath);
            if (insertedCount > 0 && newRecords.length > 0) {
              this.emit("newRecords", newRecords);

              // 消耗 token 後立即重整即時配額
              const snapshot = await this.quotaClient.getQuotaSnapshot(true);
              this.emit("quotaUpdated", snapshot);
            }
          } catch (err: any) {
            this.emit("error", err);
          }
        }, 250);

        this.debounceTimers.set(fullPath, timer);
      });

      this.watchedDirs.set(dirPath, w);
    } catch {
      // 若該目錄無法監聽則透過定期輪詢補償
    }
  }

  public stop(): void {
    this.running = false;
    for (const w of this.watchedDirs.values()) {
      try {
        w.close();
      } catch {}
    }
    this.watchedDirs.clear();

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
