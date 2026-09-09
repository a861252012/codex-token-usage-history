import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { HistoryDatabase } from "./history-db.js";
import type { TokenRecord } from "./types.js";

export class SessionIndexer {
  private codexHome: string;
  private db: HistoryDatabase;

  constructor(db: HistoryDatabase, codexHomeDir?: string) {
    this.db = db;
    this.codexHome = codexHomeDir || process.env.CODEX_HOME || join(homedir(), ".codex");
  }

  /**
   * 遞迴尋找指定目錄下的所有 .jsonl 檔案
   */
  public findJsonlFiles(dir: string, sinceMs?: number): string[] {
    if (!existsSync(dir)) return [];
    const results: string[] = [];

    const walk = (currentDir: string): void => {
      let entries;
      try {
        entries = readdirSync(currentDir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          if (sinceMs !== undefined) {
            try {
              const stat = statSync(fullPath);
              if (stat.mtimeMs >= sinceMs) {
                results.push(fullPath);
              }
            } catch {}
          } else {
            results.push(fullPath);
          }
        }
      }
    };

    walk(dir);
    return results;
  }

  /**
   * 掃描並解析單個 session jsonl 檔案
   */
  public parseFile(filePath: string): { records: TokenRecord[]; fileMtime: number; fileSize: number } {
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      return { records: [], fileMtime: 0, fileSize: 0 };
    }

    let content: string;
    try {
      content = readFileSync(filePath, "utf-8");
    } catch {
      return { records: [], fileMtime: stat.mtimeMs, fileSize: stat.size };
    }

    const lines = content.split("\n");
    const records: TokenRecord[] = [];

    let currentModel = "codex-default";
    let defaultSessionId = "";
    let lastFiveHourUsedPct: number | null = null;
    let lastWeeklyUsedPct: number | null = null;

    for (const line of lines) {
      if (!line || line.charCodeAt(0) !== 123) continue; // 必須為 '{'

      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }

      const type = parsed.type;
      const payload = parsed.payload;
      if (!payload) continue;

      // 提取 session 資訊與預設模型
      if (type === "session_meta") {
        defaultSessionId = payload.session_id || payload.id || defaultSessionId;
        if (payload.provenance?.model) {
          currentModel = payload.provenance.model;
        }
      } else if (type === "turn_context") {
        if (payload.model) {
          currentModel = payload.model;
        }
      } else if (type === "event_msg") {
        if (payload.thread_settings?.model) {
          currentModel = payload.thread_settings.model;
        }
        // 提取 rate_limits 配額快照 (嚴格檢查主配額，避免 Spark 0% 覆寫真實週用量)
        if (payload.type === "token_count" && payload.rate_limits) {
          const rl = payload.rate_limits;
          const limitId = rl.limit_id;

          // 僅接受主帳號配額 (limit_id === "codex" 或非附加模型)
          if (limitId === "codex" || !limitId || limitId === "default") {
            const primary = rl.primary;
            const secondary = rl.secondary;

            if (primary && typeof primary.used_percent === "number") {
              if (primary.window_minutes === 300) {
                lastFiveHourUsedPct = primary.used_percent;
              } else if (primary.window_minutes === 10080) {
                lastWeeklyUsedPct = primary.used_percent;
              }
            }

            if (secondary && typeof secondary.used_percent === "number") {
              if (secondary.window_minutes === 300) {
                lastFiveHourUsedPct = secondary.used_percent;
              } else if (secondary.window_minutes === 10080) {
                lastWeeklyUsedPct = secondary.used_percent;
              }
            }
          }
        }
      }

      // 提取 token 消耗紀錄
      if (type === "token_usage_record" && payload.usage) {
        const usage = payload.usage;
        const tsString = parsed.timestamp;
        const timestamp = tsString ? new Date(tsString).getTime() : Date.now();

        const inputTokens = usage.input_tokens || 0;
        const cachedInputTokens = usage.cached_input_tokens || 0;
        const outputTokens = usage.output_tokens || 0;
        const reasoningOutputTokens = usage.reasoning_output_tokens || 0;
        const totalTokens = usage.total_tokens || (inputTokens + outputTokens);

        records.push({
          timestamp,
          datetime: tsString || new Date(timestamp).toISOString(),
          sessionId: payload.session_id || defaultSessionId || "unknown",
          threadId: payload.thread_id || payload.session_id || "unknown",
          turnId: payload.turn_id || `turn-${timestamp}-${records.length}`,
          responseId: payload.response_id || undefined,
          model: currentModel,
          inputTokens,
          cachedInputTokens,
          outputTokens,
          reasoningOutputTokens,
          totalTokens,
          fiveHourUsedPct: lastFiveHourUsedPct,
          weeklyUsedPct: lastWeeklyUsedPct,
          sourceFile: filePath,
        });
      }
    }

    return { records, fileMtime: stat.mtimeMs, fileSize: stat.size };
  }

  /**
   * 增量索引單一檔案，回傳新增之紀錄陣列 (避免二次全文解析)
   */
  public indexFile(filePath: string, force = false): { insertedCount: number; newRecords: TokenRecord[] } {
    try {
      const stat = statSync(filePath);
      const cursor = this.db.getCursor(filePath);

      if (!force && cursor && cursor.mtime === stat.mtimeMs && cursor.size === stat.size) {
        return { insertedCount: 0, newRecords: [] }; // 檔案未改變，直接略過
      }

      const { records, fileMtime, fileSize } = this.parseFile(filePath);
      const insertedCount = this.db.insertBatch(records);
      this.db.updateCursor(filePath, fileMtime, fileSize, records.length);

      const newRecords = insertedCount > 0 ? records.slice(-insertedCount) : [];
      return { insertedCount, newRecords };
    } catch {
      return { insertedCount: 0, newRecords: [] };
    }
  }

  /**
   * 快速索引近期檔案 (預設最近 7 天)
   */
  public indexRecent(days = 7): { filesScanned: number; recordsInserted: number; durationMs: number } {
    const startTime = Date.now();
    const sinceMs = startTime - days * 86400 * 1000;
    const sessionDir = join(this.codexHome, "sessions");

    const files = this.findJsonlFiles(sessionDir, sinceMs);
    let recordsInserted = 0;

    for (const f of files) {
      const { insertedCount } = this.indexFile(f);
      recordsInserted += insertedCount;
    }

    return {
      filesScanned: files.length,
      recordsInserted,
      durationMs: Date.now() - startTime,
    };
  }

  /**
   * 完整背景索引所有歷史檔案
   */
  public indexAll(): { filesScanned: number; recordsInserted: number; durationMs: number } {
    const startTime = Date.now();
    const sessionDir = join(this.codexHome, "sessions");
    const archivedDir = join(this.codexHome, "archived_sessions");

    const files = [
      ...this.findJsonlFiles(sessionDir),
      ...this.findJsonlFiles(archivedDir),
    ];

    let recordsInserted = 0;
    for (const f of files) {
      const { insertedCount } = this.indexFile(f);
      recordsInserted += insertedCount;
    }

    return {
      filesScanned: files.length,
      recordsInserted,
      durationMs: Date.now() - startTime,
    };
  }
}
