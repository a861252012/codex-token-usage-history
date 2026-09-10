import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { HistoryDatabase } from "./history-db.js";
import { calculateTokenCost } from "./pricing-calculator.js";
import type { TokenRecord } from "./types.js";

export class SessionIndexer {
  private codexHome: string;
  private database: HistoryDatabase;

  constructor(database: HistoryDatabase, codexHomeDirectory?: string) {
    this.database = database;
    this.codexHome = codexHomeDirectory || process.env.CODEX_HOME || join(homedir(), ".codex");
  }

  /**
   * 遞迴尋找指定目錄下的所有 .jsonl 檔案
   */
  public findJsonlFiles(targetDirectory: string, sinceMilliseconds?: number): string[] {
    if (!existsSync(targetDirectory)) return [];
    const results: string[] = [];

    const walkDirectory = (currentDirectory: string): void => {
      let directoryEntries;
      try {
        directoryEntries = readdirSync(currentDirectory, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of directoryEntries) {
        const fullPath = join(currentDirectory, entry.name);
        if (entry.isDirectory()) {
          walkDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          if (sinceMilliseconds !== undefined) {
            try {
              const fileStatus = statSync(fullPath);
              if (fileStatus.mtimeMs >= sinceMilliseconds) {
                results.push(fullPath);
              }
            } catch {}
          } else {
            results.push(fullPath);
          }
        }
      }
    };

    walkDirectory(targetDirectory);
    return results;
  }

  /**
   * 掃描並解析單個 session jsonl 檔案
   */
  public parseFile(filePath: string): { records: TokenRecord[]; fileMtime: number; fileSize: number } {
    let fileStatus;
    try {
      fileStatus = statSync(filePath);
    } catch {
      return { records: [], fileMtime: 0, fileSize: 0 };
    }

    let fileContent: string;
    try {
      fileContent = readFileSync(filePath, "utf-8");
    } catch {
      return { records: [], fileMtime: fileStatus.mtimeMs, fileSize: fileStatus.size };
    }

    const lines = fileContent.split("\n");
    const records: TokenRecord[] = [];

    let currentModel = "codex-default";
    let defaultSessionId = "";
    let currentAgentRole: "main" | "subagent" = "main";
    let lastFiveHourUsedPercent: number | null = null;
    let lastWeeklyUsedPercent: number | null = null;

    for (const singleLine of lines) {
      if (!singleLine || singleLine.charCodeAt(0) !== 123) continue; // 必須為 '{'

      let parsedPayload: any;
      try {
        parsedPayload = JSON.parse(singleLine);
      } catch {
        continue;
      }

      const eventType = parsedPayload.type;
      const payloadData = parsedPayload.payload;
      if (!payloadData) continue;

      // 提取 session 資訊、預設模型與代理人角色
      if (eventType === "session_meta") {
        defaultSessionId = payloadData.session_id || payloadData.id || defaultSessionId;
        if (payloadData.provenance?.model) {
          currentModel = payloadData.provenance.model;
        }
        if (
          payloadData.agent_role === "subagent" ||
          payloadData.agent_type === "subagent" ||
          payloadData.parent_thread_id ||
          payloadData.source?.subagent
        ) {
          currentAgentRole = "subagent";
        }
      } else if (eventType === "turn_context") {
        if (payloadData.model) {
          currentModel = payloadData.model;
        }
        if (payloadData.role === "subagent" || payloadData.agent_role === "subagent" || payloadData.subagent_id) {
          currentAgentRole = "subagent";
        } else if (payloadData.role === "main" || payloadData.agent_role === "main") {
          currentAgentRole = "main";
        }
      } else if (eventType === "event_msg") {
        if (payloadData.thread_settings?.model) {
          currentModel = payloadData.thread_settings.model;
        }
        if (payloadData.thread_id) {
          const threadIdText = String(payloadData.thread_id);
          if (threadIdText.includes("subagent") || threadIdText.includes("sub-agent")) {
            currentAgentRole = "subagent";
          }
        }

        // 提取 rate_limits 配額快照 (嚴格檢查主配額，避免 Spark 0% 覆寫真實週用量)
        if (payloadData.type === "token_count" && payloadData.rate_limits) {
          const rateLimits = payloadData.rate_limits;
          const limitId = rateLimits.limit_id;

          // 僅接受主帳號配額 (limit_id === "codex" 或非附加模型)
          if (limitId === "codex" || !limitId || limitId === "default") {
            const primaryWindow = rateLimits.primary;
            const secondaryWindow = rateLimits.secondary;

            if (primaryWindow && typeof primaryWindow.used_percent === "number") {
              if (primaryWindow.window_minutes === 300) {
                lastFiveHourUsedPercent = primaryWindow.used_percent;
              } else if (primaryWindow.window_minutes === 10080) {
                lastWeeklyUsedPercent = primaryWindow.used_percent;
              }
            }

            if (secondaryWindow && typeof secondaryWindow.used_percent === "number") {
              if (secondaryWindow.window_minutes === 300) {
                lastFiveHourUsedPercent = secondaryWindow.used_percent;
              } else if (secondaryWindow.window_minutes === 10080) {
                lastWeeklyUsedPercent = secondaryWindow.used_percent;
              }
            }
          }
        }
      }

      // 提取 token 消耗紀錄
      if (eventType === "token_usage_record" && payloadData.usage) {
        const usageData = payloadData.usage;
        const timestampString = parsedPayload.timestamp;
        const timestampMilliseconds = timestampString ? new Date(timestampString).getTime() : Date.now();

        const inputTokens = usageData.input_tokens || 0;
        const cachedInputTokens = usageData.cached_input_tokens || 0;
        const outputTokens = usageData.output_tokens || 0;
        const reasoningOutputTokens = usageData.reasoning_output_tokens || 0;
        const totalTokens = usageData.total_tokens || (inputTokens + outputTokens);

        // 判斷此請求是否屬於 subAgent
        let recordAgentRole: "main" | "subagent" = currentAgentRole;
        if (payloadData.agent_role === "subagent" || payloadData.subagent || (payloadData.thread_id && payloadData.thread_id.includes("subagent"))) {
          recordAgentRole = "subagent";
        }

        // 計算官方 API 等值美金金額
        const costResult = calculateTokenCost(
          currentModel,
          inputTokens,
          cachedInputTokens,
          outputTokens,
          reasoningOutputTokens
        );
        const costUsd = costResult.totalCost;

        records.push({
          timestamp: timestampMilliseconds,
          datetime: timestampString || new Date(timestampMilliseconds).toISOString(),
          sessionId: payloadData.session_id || defaultSessionId || "unknown",
          threadId: payloadData.thread_id || payloadData.session_id || "unknown",
          turnId: payloadData.turn_id || `turn-${timestampMilliseconds}-${records.length}`,
          responseId: payloadData.response_id || undefined,
          model: currentModel,
          inputTokens,
          cachedInputTokens,
          outputTokens,
          reasoningOutputTokens,
          totalTokens,
          costUsd,
          agentRole: recordAgentRole,
          fiveHourUsedPercent: lastFiveHourUsedPercent,
          weeklyUsedPercent: lastWeeklyUsedPercent,
          sourceFile: filePath,
        });
      }
    }

    return { records, fileMtime: fileStatus.mtimeMs, fileSize: fileStatus.size };
  }

  /**
   * 增量索引單一檔案，回傳新增之紀錄陣列 (避免二次全文解析)
   */
  public indexFile(filePath: string, force = false): { insertedCount: number; newRecords: TokenRecord[] } {
    try {
      const fileStatus = statSync(filePath);
      const cursor = this.database.getCursor(filePath);

      if (!force && cursor && cursor.mtime === fileStatus.mtimeMs && cursor.size === fileStatus.size) {
        return { insertedCount: 0, newRecords: [] }; // 檔案未改變，直接略過
      }

      const { records, fileMtime, fileSize } = this.parseFile(filePath);
      const newRecords: TokenRecord[] = [];
      const insertedCount = this.database.insertBatch(records, (record) => newRecords.push(record));
      this.database.updateCursor(filePath, fileMtime, fileSize, records.length);

      return { insertedCount, newRecords };
    } catch {
      return { insertedCount: 0, newRecords: [] };
    }
  }

  /**
   * 快速索引近期檔案 (預設最近 7 天)
   */
  public indexRecent(days = 7): { filesScanned: number; recordsInserted: number; durationMs: number; newRecords: TokenRecord[] } {
    const startTimeMilliseconds = Date.now();
    const sinceMilliseconds = startTimeMilliseconds - days * 86400 * 1000;
    const sessionDirectory = join(this.codexHome, "sessions");

    const candidateFiles = this.findJsonlFiles(sessionDirectory, sinceMilliseconds);
    let recordsInsertedCount = 0;
    const allNewRecords: TokenRecord[] = [];

    for (const singleFilePath of candidateFiles) {
      const { insertedCount, newRecords } = this.indexFile(singleFilePath);
      recordsInsertedCount += insertedCount;
      for (const record of newRecords) allNewRecords.push(record);
    }

    return {
      filesScanned: candidateFiles.length,
      recordsInserted: recordsInsertedCount,
      durationMs: Date.now() - startTimeMilliseconds,
      newRecords: allNewRecords,
    };
  }

  /**
   * 完整背景索引所有歷史檔案
   */
  public indexAll(): { filesScanned: number; recordsInserted: number; durationMs: number } {
    const startTimeMilliseconds = Date.now();
    const sessionDirectory = join(this.codexHome, "sessions");
    const archivedDirectory = join(this.codexHome, "archived_sessions");

    const allFiles = [
      ...this.findJsonlFiles(sessionDirectory),
      ...this.findJsonlFiles(archivedDirectory),
    ];

    let recordsInsertedCount = 0;
    for (const singleFilePath of allFiles) {
      const { insertedCount } = this.indexFile(singleFilePath);
      recordsInsertedCount += insertedCount;
    }

    return {
      filesScanned: allFiles.length,
      recordsInserted: recordsInsertedCount,
      durationMs: Date.now() - startTimeMilliseconds,
    };
  }
}
