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
  private watchedDirectories = new Map<string, FSWatcher>();
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private pollInterval: NodeJS.Timeout | null = null;
  private active = false;
  private isPolling = false;

  constructor(indexer: SessionIndexer, quotaClient: QuotaClient, codexHomeDirectory?: string) {
    super();
    this.indexer = indexer;
    this.quotaClient = quotaClient;
    this.codexHome = codexHomeDirectory || process.env.CODEX_HOME || join(homedir(), ".codex");
  }

  /**
   * 啟動即時檔案監聽與定時配額輪詢
   */
  public start(pollIntervalMilliseconds = 45_000): void {
    if (this.active) return;
    this.active = true;

    // 先執行一次近期增量掃描
    try {
      this.indexer.indexRecent(3);
    } catch {}

    // 建立目錄監聽器
    this.setupDateDirectoryWatchers();

    // 定期輪詢今天目錄 (防止 fs.watch 漏掉事件，同時自動維護過期監聽器)
    this.pollInterval = setInterval(async () => {
      if (this.isPolling) return;
      this.isPolling = true;

      try {
        this.setupDateDirectoryWatchers();
        const scanResult = this.indexer.indexRecent(1);
        if (scanResult.recordsInserted > 0) {
          this.emit("newRecords", scanResult.newRecords);
          const quotaSnapshot = await this.quotaClient.getQuotaSnapshot(true);
          this.emit("quotaUpdated", quotaSnapshot);
        } else {
          const quotaSnapshot = await this.quotaClient.getQuotaSnapshot(false);
          this.emit("quotaUpdated", quotaSnapshot);
        }
      } catch (caughtError: any) {
        this.emit("error", caughtError);
      } finally {
        this.isPolling = false;
      }
    }, pollIntervalMilliseconds);
  }

  private setupDateDirectoryWatchers(): void {
    const today = new Date();
    const padNumber = (numericValue: number) => String(numericValue).padStart(2, "0");
    const year = today.getFullYear();
    const month = padNumber(today.getMonth() + 1);
    const day = padNumber(today.getDate());

    const activeDirectories = new Set<string>();

    // 今天目錄
    const sessionTodayDirectory = join(this.codexHome, "sessions", String(year), month, day);
    activeDirectories.add(sessionTodayDirectory);

    // 昨天目錄
    const yesterday = new Date(Date.now() - 86400000);
    const yesterdayMonth = padNumber(yesterday.getMonth() + 1);
    const yesterdayDay = padNumber(yesterday.getDate());
    const sessionYesterdayDirectory = join(this.codexHome, "sessions", String(yesterday.getFullYear()), yesterdayMonth, yesterdayDay);
    activeDirectories.add(sessionYesterdayDirectory);

    // 關閉並清理已失效的舊目錄監聽器 (避免記憶體與檔案描述元洩漏)
    for (const [directoryPath, directoryWatcher] of this.watchedDirectories.entries()) {
      if (!activeDirectories.has(directoryPath)) {
        try {
          directoryWatcher.close();
        } catch {}
        this.watchedDirectories.delete(directoryPath);
      }
    }

    // 加入尚未監聽的活躍目錄
    for (const directoryPath of activeDirectories) {
      if (!this.watchedDirectories.has(directoryPath)) {
        this.watchDirectory(directoryPath);
      }
    }
  }

  private watchDirectory(directoryPath: string): void {
    if (!existsSync(directoryPath)) return;
    if (this.watchedDirectories.has(directoryPath)) return; // 嚴格防止重複監聽

    try {
      const directoryWatcher = watch(directoryPath, (eventType, filename) => {
        if (!filename || !filename.endsWith(".jsonl")) return;
        const fullPath = join(directoryPath, filename);

        // 防抖動 250ms 避免檔案正在寫入中重複讀取
        const existingTimer = this.debounceTimers.get(fullPath);
        if (existingTimer) clearTimeout(existingTimer);

        const debounceTimer = setTimeout(async () => {
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
          } catch (caughtError: any) {
            this.emit("error", caughtError);
          }
        }, 250);

        this.debounceTimers.set(fullPath, debounceTimer);
      });

      directoryWatcher.on("error", () => {
        try {
          directoryWatcher.close();
        } catch {}
        this.watchedDirectories.delete(directoryPath);
      });

      this.watchedDirectories.set(directoryPath, directoryWatcher);
    } catch {
      // 若該目錄無法監聽則透過定期輪詢補償
    }
  }

  public stop(): void {
    this.active = false;
    for (const directoryWatcher of this.watchedDirectories.values()) {
      try {
        directoryWatcher.close();
      } catch {}
    }
    this.watchedDirectories.clear();

    for (const debounceTimer of this.debounceTimers.values()) {
      clearTimeout(debounceTimer);
    }
    this.debounceTimers.clear();

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}
