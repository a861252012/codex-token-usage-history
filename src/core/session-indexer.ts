import { existsSync, readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { HistoryDatabase } from "./history-db.js";
import { calculateTokenCost } from "./pricing-calculator.js";
import type { TokenRecord } from "./types.js";

const MAXIMUM_IDENTIFIER_LENGTH = 256;
const MAXIMUM_MODEL_LENGTH = 128;

function sanitizeDisplayString(value: unknown, fallback: string, maximumLength = MAXIMUM_IDENTIFIER_LENGTH): string {
  if (typeof value !== "string") return fallback;
  const sanitized = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .slice(0, maximumLength);
  return sanitized || fallback;
}

function parseTokenCount(value: unknown, fallback = 0): number | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) return null;
  return value;
}

function parseQuotaPercent(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

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
        defaultSessionId = sanitizeDisplayString(payloadData.session_id || payloadData.id, defaultSessionId);
        if (payloadData.provenance?.model) {
          currentModel = sanitizeDisplayString(payloadData.provenance.model, currentModel, MAXIMUM_MODEL_LENGTH);
        }
        if (payloadData.agent_role === "subagent" || payloadData.agent_type === "subagent") {
          currentAgentRole = "subagent";
        }
      } else if (eventType === "turn_context") {
        if (payloadData.model) {
          currentModel = sanitizeDisplayString(payloadData.model, currentModel, MAXIMUM_MODEL_LENGTH);
        }
        if (payloadData.role === "subagent" || payloadData.agent_role === "subagent" || payloadData.subagent_id) {
          currentAgentRole = "subagent";
        } else {
          currentAgentRole = "main";
        }
      } else if (eventType === "event_msg") {
        if (payloadData.thread_settings?.model) {
          currentModel = sanitizeDisplayString(payloadData.thread_settings.model, currentModel, MAXIMUM_MODEL_LENGTH);
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

            if (primaryWindow) {
              const usedPercent = parseQuotaPercent(primaryWindow.used_percent);
              if (usedPercent !== null && primaryWindow.window_minutes === 300) {
                lastFiveHourUsedPercent = usedPercent;
              } else if (usedPercent !== null && primaryWindow.window_minutes === 10080) {
                lastWeeklyUsedPercent = usedPercent;
              }
            }

            if (secondaryWindow) {
              const usedPercent = parseQuotaPercent(secondaryWindow.used_percent);
              if (usedPercent !== null && secondaryWindow.window_minutes === 300) {
                lastFiveHourUsedPercent = usedPercent;
              } else if (usedPercent !== null && secondaryWindow.window_minutes === 10080) {
                lastWeeklyUsedPercent = usedPercent;
              }
            }
          }
        }
      }

      // 提取 token 消耗紀錄
      if (eventType === "token_usage_record" && payloadData.usage) {
        const usageData = payloadData.usage;
        const timestampMilliseconds = parsedPayload.timestamp === undefined
          ? Date.now()
          : new Date(parsedPayload.timestamp).getTime();
        if (!Number.isFinite(timestampMilliseconds)) continue;

        const inputTokens = parseTokenCount(usageData.input_tokens);
        const cachedInputTokens = parseTokenCount(usageData.cached_input_tokens);
        const outputTokens = parseTokenCount(usageData.output_tokens);
        const reasoningOutputTokens = parseTokenCount(usageData.reasoning_output_tokens);
        if (inputTokens === null || cachedInputTokens === null || outputTokens === null || reasoningOutputTokens === null) {
          continue;
        }
        const totalTokens = parseTokenCount(usageData.total_tokens, inputTokens + outputTokens);
        if (totalTokens === null) continue;

        // 判斷此請求是否屬於 subAgent
        let recordAgentRole: "main" | "subagent" = currentAgentRole;
        if (payloadData.agent_role === "subagent" || payloadData.subagent || String(payloadData.thread_id || "").includes("subagent")) {
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
          datetime: new Date(timestampMilliseconds).toISOString(),
          sessionId: sanitizeDisplayString(payloadData.session_id, defaultSessionId || "unknown"),
          threadId: sanitizeDisplayString(payloadData.thread_id || payloadData.session_id, "unknown"),
          turnId: sanitizeDisplayString(payloadData.turn_id, `turn-${timestampMilliseconds}-${records.length}`),
          responseId: payloadData.response_id
            ? sanitizeDisplayString(payloadData.response_id, "") || undefined
            : undefined,
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
      const insertedCount = this.database.insertBatch(records);
      this.database.updateCursor(filePath, fileMtime, fileSize, records.length);

      let newRecords: TokenRecord[] = [];
      if (insertedCount === records.length) {
        newRecords = records;
      } else if (insertedCount > 0) {
        newRecords = records.slice(-insertedCount);
      }
      return { insertedCount, newRecords };
    } catch {
      return { insertedCount: 0, newRecords: [] };
    }
  }

  /**
   * 快速索引近期檔案 (預設最近 7 天)
   */
  public indexRecent(days = 7): { filesScanned: number; recordsInserted: number; durationMs: number } {
    const startTimeMilliseconds = Date.now();
    const sinceMilliseconds = startTimeMilliseconds - days * 86400 * 1000;
    const sessionDirectory = join(this.codexHome, "sessions");

    const candidateFiles = this.findJsonlFiles(sessionDirectory, sinceMilliseconds);
    let recordsInsertedCount = 0;

    for (const singleFilePath of candidateFiles) {
      const { insertedCount } = this.indexFile(singleFilePath);
      recordsInsertedCount += insertedCount;
    }

    return {
      filesScanned: candidateFiles.length,
      recordsInserted: recordsInsertedCount,
      durationMs: Date.now() - startTimeMilliseconds,
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
