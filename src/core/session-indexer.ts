import { existsSync, readdirSync, statSync, openSync, readSync, closeSync, type Stats } from "node:fs";
import { StringDecoder } from "node:string_decoder";
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

function* readJsonlLines(filePath: string, fileSize: number): Generator<string> {
  const descriptor = openSync(filePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(64 * 1024);
    const decoder = new StringDecoder("utf8");
    let position = 0;
    const lineParts: string[] = [];
    while (position < fileSize) {
      const bytesRead = readSync(descriptor, buffer, 0, Math.min(buffer.length, fileSize - position), position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const chunk = decoder.write(buffer.subarray(0, bytesRead));
      let start = 0;
      let newline = chunk.indexOf("\n", start);
      while (newline !== -1) {
        lineParts.push(chunk.slice(start, newline));
        yield lineParts.join("");
        lineParts.length = 0;
        start = newline + 1;
        newline = chunk.indexOf("\n", start);
      }
      if (start < chunk.length) lineParts.push(chunk.slice(start));
    }
    const tail = decoder.end();
    if (tail) lineParts.push(tail);
    if (lineParts.length > 0) yield lineParts.join("");
  } finally {
    closeSync(descriptor);
  }
}

export class SessionIndexer {
  private codexHome: string;
  private database: HistoryDatabase;
  private diagnostics: MutableSessionIndexDiagnostics;

  constructor(database: HistoryDatabase, codexHomeDirectory?: string) {
    this.database = database;
    this.codexHome = codexHomeDirectory || process.env.CODEX_HOME || join(homedir(), ".codex");
    this.diagnostics = this.createDiagnostics("none");
  }

  /** 取得最近一次索引工作的唯讀診斷快照。 */
  public getDiagnostics(): Readonly<SessionIndexDiagnostics> {
    return Object.freeze({
      ...this.diagnostics,
      missingDirectories: Object.freeze([...this.diagnostics.missingDirectories]),
    });
  }

  private createDiagnostics(scope: SessionIndexScope): MutableSessionIndexDiagnostics {
    return {
      dataDirectory: this.codexHome,
      scope,
      scannedAt: null,
      lastSuccessfulScanAt: this.diagnostics?.lastSuccessfulScanAt ?? null,
      filesDiscovered: 0,
      filesRead: 0,
      filesUnchanged: 0,
      filesFailed: 0,
      recordsParsed: 0,
      recordsInserted: 0,
      invalidLines: 0,
      unsupportedEvents: 0,
      invalidRecords: 0,
      missingDirectories: [],
      dataStartMs: null,
      dataEndMs: null,
    };
  }

  private finishDiagnostics(diagnostics: MutableSessionIndexDiagnostics): void {
    diagnostics.scannedAt = Date.now();
    if (diagnostics.filesFailed === 0 && diagnostics.missingDirectories.length === 0) {
      diagnostics.lastSuccessfulScanAt = diagnostics.scannedAt;
    }
    this.diagnostics = diagnostics;
  }

  private mergeParseDiagnostics(diagnostics: MutableSessionIndexDiagnostics, parsedFile: ParsedFileResult): void {
    diagnostics.invalidLines += parsedFile.invalidLines;
    diagnostics.unsupportedEvents += parsedFile.unsupportedEvents;
    diagnostics.invalidRecords += parsedFile.invalidRecords;
    diagnostics.recordsParsed += parsedFile.records.length;
    if (parsedFile.dataStartMs !== null) {
      diagnostics.dataStartMs = diagnostics.dataStartMs === null
        ? parsedFile.dataStartMs
        : Math.min(diagnostics.dataStartMs, parsedFile.dataStartMs);
    }
    if (parsedFile.dataEndMs !== null) {
      diagnostics.dataEndMs = diagnostics.dataEndMs === null
        ? parsedFile.dataEndMs
        : Math.max(diagnostics.dataEndMs, parsedFile.dataEndMs);
    }
  }

  /**
   * 遞迴尋找指定目錄下的所有 .jsonl 檔案
   */
  public findJsonlFiles(targetDirectory: string, sinceMilliseconds?: number): string[] {
    return this.discoverJsonlFiles(targetDirectory, sinceMilliseconds).map((file) => file.filePath);
  }

  private discoverJsonlFiles(
    targetDirectory: string,
    sinceMilliseconds: number | undefined,
    diagnostics?: MutableSessionIndexDiagnostics
  ): { filePath: string; status: Stats }[] {
    if (!existsSync(targetDirectory)) {
      diagnostics?.missingDirectories.push(targetDirectory);
      return [];
    }

    const results: { filePath: string; status: Stats }[] = [];
    const walkDirectory = (currentDirectory: string): void => {
      let directoryEntries;
      try {
        directoryEntries = readdirSync(currentDirectory, { withFileTypes: true });
      } catch {
        diagnostics?.missingDirectories.push(currentDirectory);
        return;
      }

      for (const entry of directoryEntries) {
        const fullPath = join(currentDirectory, entry.name);
        if (entry.isDirectory()) {
          walkDirectory(fullPath);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          try {
            const status = statSync(fullPath);
            if (sinceMilliseconds === undefined || status.mtimeMs >= sinceMilliseconds) results.push({ filePath: fullPath, status });
          } catch {
            if (diagnostics) diagnostics.filesFailed += 1;
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
    const diagnostics = this.createDiagnostics("file");
    diagnostics.filesDiscovered = 1;
    const parsedFile = this.parseFileDetailed(filePath);
    if (parsedFile.readSucceeded) diagnostics.filesRead = 1;
    else diagnostics.filesFailed = 1;
    this.mergeParseDiagnostics(diagnostics, parsedFile);
    this.finishDiagnostics(diagnostics);
    return {
      records: parsedFile.records,
      fileMtime: parsedFile.fileMtime,
      fileSize: parsedFile.fileSize,
    };
  }

  private parseFileDetailed(filePath: string, knownStatus?: Stats): ParsedFileResult {
    let fileStatus;
    try {
      fileStatus = knownStatus ?? statSync(filePath);
    } catch {
      return createFailedParsedFile();
    }

    const records: TokenRecord[] = [];

    let currentModel = "codex-default";
    let defaultSessionId = "";
    let currentAgentRole: "main" | "subagent" | "unknown" = "unknown";
    let lastFiveHourUsedPercent: number | null = null;
    let lastWeeklyUsedPercent: number | null = null;
    let invalidLines = 0;
    let unsupportedEvents = 0;
    let invalidRecords = 0;
    let dataStartMs: number | null = null;
    let dataEndMs: number | null = null;

    const supportedEventTypes = new Set(["session_meta", "turn_context", "event_msg", "token_usage_record"]);

    try {
      for (const singleLine of readJsonlLines(filePath, fileStatus.size)) {
        if (!singleLine.trim()) continue;

        let parsedPayload: any;
        try {
          parsedPayload = JSON.parse(singleLine);
        } catch {
          invalidLines += 1;
          continue;
        }

        const eventType = parsedPayload.type;
        const payloadData = parsedPayload.payload;
        if (!supportedEventTypes.has(eventType)) {
          unsupportedEvents += 1;
          continue;
        }
        if (!payloadData || typeof payloadData !== "object") {
          invalidRecords += 1;
          continue;
        }

        // 提取 session 資訊、預設模型與代理人角色
        if (eventType === "session_meta") {
          defaultSessionId = sanitizeDisplayString(payloadData.session_id || payloadData.id, defaultSessionId);
          if (payloadData.provenance?.model) {
            currentModel = sanitizeDisplayString(payloadData.provenance.model, currentModel, MAXIMUM_MODEL_LENGTH);
          }
          if (
            payloadData.agent_role === "subagent" ||
            payloadData.agent_type === "subagent" ||
            payloadData.parent_thread_id ||
            payloadData.source?.subagent
          ) {
            currentAgentRole = "subagent";
          } else if (payloadData.agent_role === "main" || payloadData.agent_type === "main" || ["cli", "vscode", "exec", "mcp"].includes(payloadData.source)) {
            currentAgentRole = "main";
          }
        } else if (eventType === "turn_context") {
          if (payloadData.model) {
            currentModel = sanitizeDisplayString(payloadData.model, currentModel, MAXIMUM_MODEL_LENGTH);
          }
          if (payloadData.role === "subagent" || payloadData.agent_role === "subagent" || payloadData.subagent_id) {
            currentAgentRole = "subagent";
          } else if (payloadData.role === "main" || payloadData.agent_role === "main") {
            currentAgentRole = "main";
          }
        } else if (eventType === "event_msg") {
          if (payloadData.thread_settings?.model) {
            currentModel = sanitizeDisplayString(payloadData.thread_settings.model, currentModel, MAXIMUM_MODEL_LENGTH);
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
        if (
          eventType === "token_usage_record" &&
          payloadData.usage &&
          typeof payloadData.usage === "object" &&
          [
            "input_tokens",
            "cached_input_tokens",
            "output_tokens",
            "reasoning_output_tokens",
            "total_tokens",
          ].some((fieldName) => payloadData.usage[fieldName] !== undefined)
        ) {
          const usageData = payloadData.usage;
          const timestampMilliseconds = parsedPayload.timestamp === undefined
            ? Date.now()
            : new Date(parsedPayload.timestamp).getTime();
          if (!Number.isFinite(timestampMilliseconds)) {
            invalidRecords += 1;
            continue;
          }

          const inputTokens = parseTokenCount(usageData.input_tokens);
          const cachedInputTokens = parseTokenCount(usageData.cached_input_tokens);
          const outputTokens = parseTokenCount(usageData.output_tokens);
          const reasoningOutputTokens = parseTokenCount(usageData.reasoning_output_tokens);
          if (inputTokens === null || cachedInputTokens === null || outputTokens === null || reasoningOutputTokens === null) {
            invalidRecords += 1;
            continue;
          }
          const totalTokens = parseTokenCount(usageData.total_tokens, inputTokens + outputTokens);
          if (totalTokens === null) {
            invalidRecords += 1;
            continue;
          }

          // 判斷此請求是否屬於 subAgent
          let recordAgentRole: "main" | "subagent" | "unknown" = currentAgentRole;
          if (payloadData.agent_role === "subagent" || payloadData.agent_type === "subagent") {
            recordAgentRole = "subagent";
          } else if (payloadData.agent_role === "main" || payloadData.agent_type === "main") {
            recordAgentRole = "main";
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
            pricingSource: costResult.pricingSource,
            pricingVersion: costResult.pricingVersion,
            agentRole: recordAgentRole,
            fiveHourUsedPercent: lastFiveHourUsedPercent,
            weeklyUsedPercent: lastWeeklyUsedPercent,
            sourceFile: filePath,
          });
          dataStartMs = dataStartMs === null ? timestampMilliseconds : Math.min(dataStartMs, timestampMilliseconds);
          dataEndMs = dataEndMs === null ? timestampMilliseconds : Math.max(dataEndMs, timestampMilliseconds);
        } else if (eventType === "token_usage_record") {
          invalidRecords += 1;
        }
      }
    } catch {
      return createFailedParsedFile(fileStatus.mtimeMs, fileStatus.size);
    }

    return {
      records,
      fileMtime: fileStatus.mtimeMs,
      fileSize: fileStatus.size,
      readSucceeded: true,
      invalidLines,
      unsupportedEvents,
      invalidRecords,
      dataStartMs,
      dataEndMs,
    };
  }

  /**
   * 增量索引單一檔案，回傳新增之紀錄陣列 (避免二次全文解析)
   */
  public indexFile(filePath: string, force = false): { insertedCount: number; newRecords: TokenRecord[] } {
    const diagnostics = this.createDiagnostics("file");
    diagnostics.filesDiscovered = 1;
    const result = this.indexFileDetailed(filePath, force, diagnostics);
    this.finishDiagnostics(diagnostics);
    return result;
  }

  private indexFileDetailed(
    filePath: string,
    force: boolean,
    diagnostics: MutableSessionIndexDiagnostics,
    knownStatus?: Stats
  ): { insertedCount: number; newRecords: TokenRecord[] } {
    try {
      const fileStatus = knownStatus ?? statSync(filePath);
      const cursor = this.database.getCursor(filePath);

      if (!force && cursor && cursor.mtime === fileStatus.mtimeMs && cursor.size === fileStatus.size) {
        diagnostics.filesUnchanged += 1;
        return { insertedCount: 0, newRecords: [] };
      }

      const parsedFile = this.parseFileDetailed(filePath, fileStatus);
      this.mergeParseDiagnostics(diagnostics, parsedFile);
      if (!parsedFile.readSucceeded) {
        diagnostics.filesFailed += 1;
        return { insertedCount: 0, newRecords: [] };
      }

      diagnostics.filesRead += 1;
      const newRecords: TokenRecord[] = [];
      const insertedCount = this.database.insertBatch(
        parsedFile.records,
        (record) => newRecords.push(record),
        { updateExistingMetadata: force }
      );
      this.database.updateCursor(filePath, parsedFile.fileMtime, parsedFile.fileSize, parsedFile.records.length);
      diagnostics.recordsInserted += insertedCount;

      return { insertedCount, newRecords };
    } catch {
      diagnostics.filesFailed += 1;
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

    const diagnostics = this.createDiagnostics("recent");
    const candidateFiles = this.discoverJsonlFiles(sessionDirectory, sinceMilliseconds, diagnostics);
    diagnostics.filesDiscovered = candidateFiles.length + diagnostics.filesFailed;
    let recordsInsertedCount = 0;
    const allNewRecords: TokenRecord[] = [];

    for (const file of candidateFiles) {
      const { insertedCount, newRecords } = this.indexFileDetailed(file.filePath, false, diagnostics, file.status);
      recordsInsertedCount += insertedCount;
      for (const record of newRecords) allNewRecords.push(record);
    }

    this.finishDiagnostics(diagnostics);
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
  public indexAll(force = false): { filesScanned: number; recordsInserted: number; durationMs: number } {
    const startTimeMilliseconds = Date.now();
    const sessionDirectory = join(this.codexHome, "sessions");
    const archivedDirectory = join(this.codexHome, "archived_sessions");

    const diagnostics = this.createDiagnostics("all");
    const allFiles = [
      ...this.discoverJsonlFiles(sessionDirectory, undefined, diagnostics),
      ...this.discoverJsonlFiles(archivedDirectory, undefined, diagnostics),
    ];
    diagnostics.filesDiscovered = allFiles.length + diagnostics.filesFailed;

    let recordsInsertedCount = 0;
    for (const file of allFiles) {
      const { insertedCount } = this.indexFileDetailed(file.filePath, force, diagnostics, file.status);
      recordsInsertedCount += insertedCount;
    }

    this.finishDiagnostics(diagnostics);
    return {
      filesScanned: allFiles.length,
      recordsInserted: recordsInsertedCount,
      durationMs: Date.now() - startTimeMilliseconds,
    };
  }
}

export type SessionIndexScope = "none" | "file" | "recent" | "all";

export interface SessionIndexDiagnostics {
  dataDirectory: string;
  scope: SessionIndexScope;
  scannedAt: number | null;
  lastSuccessfulScanAt: number | null;
  filesDiscovered: number;
  filesRead: number;
  filesUnchanged: number;
  filesFailed: number;
  recordsParsed: number;
  recordsInserted: number;
  invalidLines: number;
  unsupportedEvents: number;
  invalidRecords: number;
  missingDirectories: readonly string[];
  dataStartMs: number | null;
  dataEndMs: number | null;
}

type MutableSessionIndexDiagnostics = Omit<SessionIndexDiagnostics, "missingDirectories"> & {
  missingDirectories: string[];
};

interface ParsedFileResult {
  records: TokenRecord[];
  fileMtime: number;
  fileSize: number;
  readSucceeded: boolean;
  invalidLines: number;
  unsupportedEvents: number;
  invalidRecords: number;
  dataStartMs: number | null;
  dataEndMs: number | null;
}

function createFailedParsedFile(fileMtime = 0, fileSize = 0): ParsedFileResult {
  return {
    records: [],
    fileMtime,
    fileSize,
    readSucceeded: false,
    invalidLines: 0,
    unsupportedEvents: 0,
    invalidRecords: 0,
    dataStartMs: null,
    dataEndMs: null,
  };
}
