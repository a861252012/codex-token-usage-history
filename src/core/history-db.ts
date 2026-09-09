import { join } from "node:path";
import { homedir } from "node:os";
import { mkdirSync } from "node:fs";
import { createSqliteDb, type SqliteDb } from "./sqlite-adapter.js";
import type { TokenRecord, UsageSummary, ModelUsageStats, FilterOptions } from "./types.js";

export class HistoryDatabase {
  private db: SqliteDb | null = null;
  private dbPath: string;

  constructor(customDbPath?: string) {
    if (customDbPath) {
      this.dbPath = customDbPath;
    } else {
      const baseDir = process.env.CODEX_HOME || join(homedir(), ".codex");
      mkdirSync(baseDir, { recursive: true });
      this.dbPath = join(baseDir, "token_usage_history.sqlite");
    }
  }

  /**
   * 初始化資料庫結構與索引
   */
  public async init(): Promise<void> {
    if (this.db) return;
    this.db = await createSqliteDb(this.dbPath);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS token_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        datetime TEXT NOT NULL,
        session_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        turn_id TEXT NOT NULL,
        response_id TEXT,
        model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        five_hour_used_pct REAL,
        weekly_used_pct REAL,
        source_file TEXT,
        UNIQUE(turn_id, timestamp, total_tokens)
      );

      CREATE INDEX IF NOT EXISTS idx_records_timestamp ON token_records(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_records_model ON token_records(model);
      CREATE INDEX IF NOT EXISTS idx_records_session ON token_records(session_id);

      CREATE TABLE IF NOT EXISTS file_scan_cursor (
        file_path TEXT PRIMARY KEY,
        mtime INTEGER NOT NULL,
        size INTEGER NOT NULL,
        last_scanned_at INTEGER NOT NULL,
        records_count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  private ensureDb(): SqliteDb {
    if (!this.db) {
      throw new Error("資料庫尚未初始化，請先呼叫 init()");
    }
    return this.db;
  }

  /**
   * 寫入單筆消耗紀錄
   */
  public insertRecord(record: TokenRecord): boolean {
    const db = this.ensureDb();
    try {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO token_records (
          timestamp, datetime, session_id, thread_id, turn_id, response_id,
          model, input_tokens, cached_input_tokens, output_tokens,
          reasoning_output_tokens, total_tokens, five_hour_used_pct,
          weekly_used_pct, source_file
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const res = stmt.run(
        record.timestamp,
        record.datetime,
        record.sessionId,
        record.threadId,
        record.turnId,
        record.responseId || null,
        record.model,
        record.inputTokens,
        record.cachedInputTokens,
        record.outputTokens,
        record.reasoningOutputTokens,
        record.totalTokens,
        record.fiveHourUsedPct ?? null,
        record.weeklyUsedPct ?? null,
        record.sourceFile || null
      );

      return res.changes > 0;
    } catch {
      return false;
    }
  }

  /**
   * 批次寫入消耗紀錄 (使用交易保證效能)
   */
  public insertBatch(records: TokenRecord[]): number {
    if (records.length === 0) return 0;
    const db = this.ensureDb();
    let inserted = 0;

    db.transaction(() => {
      const stmt = db.prepare(`
        INSERT OR IGNORE INTO token_records (
          timestamp, datetime, session_id, thread_id, turn_id, response_id,
          model, input_tokens, cached_input_tokens, output_tokens,
          reasoning_output_tokens, total_tokens, five_hour_used_pct,
          weekly_used_pct, source_file
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const r of records) {
        const res = stmt.run(
          r.timestamp,
          r.datetime,
          r.sessionId,
          r.threadId,
          r.turnId,
          r.responseId || null,
          r.model,
          r.inputTokens,
          r.cachedInputTokens,
          r.outputTokens,
          r.reasoningOutputTokens,
          r.totalTokens,
          r.fiveHourUsedPct ?? null,
          r.weeklyUsedPct ?? null,
          r.sourceFile || null
        );
        if (res.changes > 0) inserted += 1;
      }
    });

    return inserted;
  }

  /**
   * 取得檔案掃描進度游標
   */
  public getCursor(filePath: string): { mtime: number; size: number; recordsCount: number } | null {
    const db = this.ensureDb();
    const row = db.prepare("SELECT mtime, size, records_count FROM file_scan_cursor WHERE file_path = ?").get(filePath);
    if (!row) return null;
    return {
      mtime: row.mtime,
      size: row.size,
      recordsCount: row.records_count,
    };
  }

  /**
   * 更新檔案掃描游標
   */
  public updateCursor(filePath: string, mtime: number, size: number, recordsCount: number): void {
    const db = this.ensureDb();
    const stmt = db.prepare(`
      INSERT INTO file_scan_cursor (file_path, mtime, size, last_scanned_at, records_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        mtime = excluded.mtime,
        size = excluded.size,
        last_scanned_at = excluded.last_scanned_at,
        records_count = excluded.records_count
    `);
    stmt.run(filePath, mtime, size, Date.now(), recordsCount);
  }

  /**
   * 查詢消耗歷史紀錄 (格式化為本地時間)
   */
  public queryRecords(options: FilterOptions = {}): { total: number; records: TokenRecord[] } {
    const db = this.ensureDb();
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    const conditions: string[] = [];
    const params: any[] = [];

    if (options.sinceMs !== undefined) {
      conditions.push("timestamp >= ?");
      params.push(options.sinceMs);
    }
    if (options.model) {
      conditions.push("model = ?");
      params.push(options.model);
    }
    if (options.sessionId) {
      conditions.push("session_id = ?");
      params.push(options.sessionId);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRow = db.prepare(`SELECT COUNT(*) as count FROM token_records ${whereClause}`).get(...params);
    const total = Number(countRow?.count ?? 0);

    const querySql = `
      SELECT
        id, timestamp, datetime, session_id, thread_id, turn_id, response_id,
        model, input_tokens, cached_input_tokens, output_tokens,
        reasoning_output_tokens, total_tokens, five_hour_used_pct,
        weekly_used_pct, source_file
      FROM token_records
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;
    const rows = db.prepare(querySql).all(...params, limit, offset);

    const records: TokenRecord[] = rows.map((r: any) => ({
      id: r.id,
      timestamp: r.timestamp,
      datetime: r.datetime,
      sessionId: r.session_id,
      threadId: r.thread_id,
      turnId: r.turn_id,
      responseId: r.response_id || undefined,
      model: r.model,
      inputTokens: r.input_tokens,
      cachedInputTokens: r.cached_input_tokens,
      outputTokens: r.output_tokens,
      reasoningOutputTokens: r.reasoning_output_tokens,
      totalTokens: r.total_tokens,
      fiveHourUsedPct: r.five_hour_used_pct,
      weeklyUsedPct: r.weekly_used_pct,
      sourceFile: r.source_file,
    }));

    return { total, records };
  }

  /**
   * 取得指定時間範圍內的消耗彙總 (燃燒率依過去 1 小時滾動視窗計算)
   */
  public getSummary(sinceMs?: number): UsageSummary {
    const db = this.ensureDb();
    const where = sinceMs !== undefined ? "WHERE timestamp >= ?" : "";
    const params = sinceMs !== undefined ? [sinceMs] : [];

    const totalRow = db.prepare(`
      SELECT
        COUNT(*) as requests,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(cached_input_tokens), 0) as cached_input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(reasoning_output_tokens), 0) as reasoning_output_tokens,
        MIN(timestamp) as min_ts,
        MAX(timestamp) as max_ts
      FROM token_records
      ${where}
    `).get(...params);

    const modelRows = db.prepare(`
      SELECT
        model,
        COUNT(*) as requests,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(cached_input_tokens), 0) as cached_input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(reasoning_output_tokens), 0) as reasoning_output_tokens
      FROM token_records
      ${where}
      GROUP BY model
      ORDER BY total_tokens DESC
    `).all(...params);

    const byModel: ModelUsageStats[] = modelRows.map((r: any) => ({
      model: r.model,
      requests: Number(r.requests),
      inputTokens: Number(r.input_tokens),
      cachedInputTokens: Number(r.cached_input_tokens),
      outputTokens: Number(r.output_tokens),
      reasoningOutputTokens: Number(r.reasoning_output_tokens),
      totalTokens: Number(r.total_tokens),
    }));

    const startMs = totalRow?.min_ts ? Number(totalRow.min_ts) : (sinceMs ?? Date.now());
    const endMs = totalRow?.max_ts ? Number(totalRow.max_ts) : Date.now();

    // 燃燒率改依過去 60 分鐘內實際消耗計算 (真實反映當下負載)
    const oneHourAgo = Date.now() - 3600000;
    const lastHourRow = db.prepare(`
      SELECT COALESCE(SUM(total_tokens), 0) as burn_rate
      FROM token_records
      WHERE timestamp >= ?
    `).get(oneHourAgo);
    const hourlyBurnRate = Number(lastHourRow?.burn_rate ?? 0);

    return {
      requests: Number(totalRow?.requests ?? 0),
      totalTokens: Number(totalRow?.total_tokens ?? 0),
      inputTokens: Number(totalRow?.input_tokens ?? 0),
      cachedInputTokens: Number(totalRow?.cached_input_tokens ?? 0),
      outputTokens: Number(totalRow?.output_tokens ?? 0),
      reasoningOutputTokens: Number(totalRow?.reasoning_output_tokens ?? 0),
      byModel,
      hourlyBurnRate,
      timeRange: { startMs, endMs },
    };
  }

  /**
   * 取得每小時 Token 消耗統計 (依本地時區轉換)
   */
  public getHourlyStats(hours = 24): Array<{ hour: string; tokens: number; requests: number }> {
    const db = this.ensureDb();
    const sinceMs = Date.now() - hours * 3600 * 1000;

    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00', datetime, 'localtime') as hour,
        COALESCE(SUM(total_tokens), 0) as tokens,
        COUNT(*) as requests
      FROM token_records
      WHERE timestamp >= ?
      GROUP BY hour
      ORDER BY hour ASC
    `).all(sinceMs);

    return rows.map((r: any) => ({
      hour: r.hour,
      tokens: Number(r.tokens),
      requests: Number(r.requests),
    }));
  }

  /**
   * 取得每日 Token 消耗統計 (依本地時區轉換)
   */
  public getDailyStats(days = 14): Array<{ date: string; tokens: number; requests: number }> {
    const db = this.ensureDb();
    const sinceMs = Date.now() - days * 86400 * 1000;

    const rows = db.prepare(`
      SELECT
        strftime('%Y-%m-%d', datetime, 'localtime') as date,
        COALESCE(SUM(total_tokens), 0) as tokens,
        COUNT(*) as requests
      FROM token_records
      WHERE timestamp >= ?
      GROUP BY date
      ORDER BY date ASC
    `).all(sinceMs);

    return rows.map((r: any) => ({
      date: r.date,
      tokens: Number(r.tokens),
      requests: Number(r.requests),
    }));
  }

  /**
   * 取得最新一筆消耗紀錄
   */
  public getLatestRecord(): TokenRecord | null {
    const db = this.ensureDb();
    const r = db.prepare("SELECT * FROM token_records ORDER BY timestamp DESC LIMIT 1").get();
    if (!r) return null;
    return {
      id: r.id,
      timestamp: r.timestamp,
      datetime: r.datetime,
      sessionId: r.session_id,
      threadId: r.thread_id,
      turnId: r.turn_id,
      responseId: r.response_id || undefined,
      model: r.model,
      inputTokens: r.input_tokens,
      cachedInputTokens: r.cached_input_tokens,
      outputTokens: r.output_tokens,
      reasoningOutputTokens: r.reasoning_output_tokens,
      totalTokens: r.total_tokens,
      fiveHourUsedPct: r.five_hour_used_pct,
      weeklyUsedPct: r.weekly_used_pct,
      sourceFile: r.source_file,
    };
  }

  public close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
