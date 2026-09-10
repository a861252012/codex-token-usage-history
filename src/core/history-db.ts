import { join } from "node:path";
import { homedir } from "node:os";
import { chmodSync, closeSync, fchmodSync, mkdirSync, openSync } from "node:fs";
import { createSqliteDb, type SqliteDb } from "./sqlite-adapter.js";
import { calculateTokenCost } from "./pricing-calculator.js";
import type {
  TokenRecord,
  UsageSummary,
  ModelUsageStats,
  FilterOptions,
  QuotaResetEvent,
  SettlementRecord,
  PlanChangeEvent,
  AgentRole,
  PricingProvenanceBreakdown,
  PricingSource,
} from "./types.js";

const VALID_AGENT_ROLES = new Set<AgentRole>(["main", "subagent", "unknown"]);
const VALID_PRICING_SOURCES = new Set<PricingSource>([
  "user-config",
  "upstream-cache",
  "builtin",
  "fallback",
  "unknown",
]);

function normalizeAgentRole(value: unknown): AgentRole {
  return typeof value === "string" && VALID_AGENT_ROLES.has(value as AgentRole)
    ? value as AgentRole
    : "unknown";
}

function normalizePricingSource(value: unknown): PricingSource {
  return typeof value === "string" && VALID_PRICING_SOURCES.has(value as PricingSource)
    ? value as PricingSource
    : "unknown";
}

function normalizePricingVersion(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "unknown";
}

function mapPricingProvenanceRows(rows: any[]): PricingProvenanceBreakdown[] {
  return rows.map((row: any) => ({
    source: normalizePricingSource(row.pricing_source),
    version: normalizePricingVersion(row.pricing_version),
    records: Number(row.records),
  }));
}

export class HistoryDatabase {
  private databaseInstance: SqliteDb | null = null;
  private databaseFilePath: string;

  constructor(customDatabasePath?: string) {
    if (customDatabasePath) {
      this.databaseFilePath = customDatabasePath;
    } else {
      const baseDirectory = process.env.CODEX_HOME || join(homedir(), ".codex");
      mkdirSync(baseDirectory, { recursive: true });
      this.databaseFilePath = join(baseDirectory, "token_usage_history.sqlite");
    }
  }

  /**
   * 初始化資料庫結構、欄位與索引
   */
  public async init(): Promise<void> {
    if (this.databaseInstance) return;
    if (this.databaseFilePath !== ":memory:") {
      const descriptor = openSync(this.databaseFilePath, "a", 0o600);
      try {
        fchmodSync(descriptor, 0o600);
      } finally {
        closeSync(descriptor);
      }
      // Older processes may still hold sidecars created with broader permissions.
      for (const suffix of ["-wal", "-shm"]) {
        try {
          chmodSync(`${this.databaseFilePath}${suffix}`, 0o600);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    this.databaseInstance = await createSqliteDb(this.databaseFilePath);

    // 1. Token 消耗紀錄表
    this.databaseInstance.exec(`
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
        agent_role TEXT NOT NULL DEFAULT 'unknown',
        cost_usd REAL NOT NULL DEFAULT 0.0,
        pricing_source TEXT NOT NULL DEFAULT 'unknown',
        pricing_version TEXT NOT NULL DEFAULT 'unknown',
        five_hour_used_pct REAL,
        weekly_used_pct REAL,
        source_file TEXT,
        UNIQUE(session_id, turn_id, model, timestamp)
      );

      CREATE INDEX IF NOT EXISTS idx_token_records_timestamp ON token_records(timestamp);
      CREATE INDEX IF NOT EXISTS idx_token_records_model ON token_records(model);
      CREATE INDEX IF NOT EXISTS idx_token_records_session_id ON token_records(session_id);
    `);

    // 2. 自動平滑移轉：舊資料無法證明角色或當時計價來源時，一律保守標為 unknown
    try {
      this.databaseInstance.exec(`ALTER TABLE token_records ADD COLUMN agent_role TEXT NOT NULL DEFAULT 'unknown';`);
    } catch {
      // 欄位已存在
    }
    try {
      this.databaseInstance.exec(`ALTER TABLE token_records ADD COLUMN cost_usd REAL NOT NULL DEFAULT 0.0;`);
    } catch {
      // 欄位已存在
    }
    try {
      this.databaseInstance.exec(`ALTER TABLE token_records ADD COLUMN pricing_source TEXT NOT NULL DEFAULT 'unknown';`);
    } catch {
      // 欄位已存在
    }
    try {
      this.databaseInstance.exec(`ALTER TABLE token_records ADD COLUMN pricing_version TEXT NOT NULL DEFAULT 'unknown';`);
    } catch {
      // 欄位已存在
    }

    this.databaseInstance.exec(`
      CREATE TABLE IF NOT EXISTS history_schema_migrations (
        migration_name TEXT PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    const roleMigrationName = "agent-role-unknown-v1";
    const roleMigration = this.databaseInstance.prepare(
      "SELECT migration_name FROM history_schema_migrations WHERE migration_name = ?"
    ).get(roleMigrationName);
    if (!roleMigration) {
      this.databaseInstance.runTransaction(() => {
        // 舊版 indexer 會把缺少角色證據的資料預設成 main，無法安全區分，先降級為 unknown。
        this.databaseInstance!.exec(`
          UPDATE token_records
          SET agent_role = 'unknown'
          WHERE agent_role = 'main'
             OR agent_role IS NULL
             OR agent_role NOT IN ('main', 'subagent', 'unknown');
        `);
        this.databaseInstance!.prepare(
          "INSERT INTO history_schema_migrations (migration_name, applied_at) VALUES (?, ?)"
        ).run(roleMigrationName, Date.now());
      });
    }

    // 建立 agent_role 索引 (確保欄位已存在)
    try {
      this.databaseInstance.exec(`CREATE INDEX IF NOT EXISTS idx_token_records_agent_role ON token_records(agent_role);`);
    } catch {
      // 忽略
    }

    // 3. OpenAI 配額重置與重置券變更事件表
    this.databaseInstance.exec(`
      CREATE TABLE IF NOT EXISTS quota_reset_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        datetime TEXT NOT NULL,
        event_type TEXT NOT NULL,
        previous_five_hour_used_pct REAL,
        new_five_hour_used_pct REAL,
        previous_weekly_used_pct REAL,
        new_weekly_used_pct REAL,
        available_credits INTEGER NOT NULL DEFAULT 0,
        credit_delta INTEGER NOT NULL DEFAULT 0,
        description TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_quota_reset_events_timestamp ON quota_reset_events(timestamp);
    `);

    // 4. OpenAI 方案異動歷史紀錄表 (升級、降級、切換)
    this.databaseInstance.exec(`
      CREATE TABLE IF NOT EXISTS plan_change_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL,
        datetime TEXT NOT NULL,
        previous_plan TEXT NOT NULL,
        new_plan TEXT NOT NULL,
        change_type TEXT NOT NULL,
        description TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_plan_change_events_timestamp ON plan_change_events(timestamp);
    `);

    // 5. 檔案掃描游標紀錄表 (用於增量掃描跳過未異動檔案)
    this.databaseInstance.exec(`
      CREATE TABLE IF NOT EXISTS file_scan_cursor (
        file_path TEXT PRIMARY KEY,
        mtime REAL NOT NULL,
        size INTEGER NOT NULL,
        last_scanned_at INTEGER NOT NULL,
        records_count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  private ensureDatabase(): SqliteDb {
    if (!this.databaseInstance) {
      throw new Error("資料庫尚未初始化，請先呼叫 init()");
    }
    return this.databaseInstance;
  }

  /**
   * 寫入單筆消耗紀錄 (自動計算等值美元金額)
   */
  public insertRecord(record: TokenRecord): boolean {
    const database = this.ensureDatabase();
    const costResult = calculateTokenCost(
      record.model,
      record.inputTokens,
      record.cachedInputTokens,
      record.outputTokens,
      record.reasoningOutputTokens
    );

    const calculatedCostUsd =
      record.costUsd == null || !Number.isFinite(record.costUsd)
        ? costResult.totalCost
        : record.costUsd;
    const resolvedAgentRole = normalizeAgentRole(record.agentRole);
    const pricingSource = record.costUsd == null || !Number.isFinite(record.costUsd)
      ? costResult.pricingSource
      : normalizePricingSource(record.pricingSource);
    const pricingVersion = record.costUsd == null || !Number.isFinite(record.costUsd)
      ? costResult.pricingVersion
      : normalizePricingVersion(record.pricingVersion);

    try {
      const statement = database.prepare(`
        INSERT OR IGNORE INTO token_records (
          timestamp, datetime, session_id, thread_id, turn_id, response_id,
          model, input_tokens, cached_input_tokens, output_tokens,
          reasoning_output_tokens, total_tokens, agent_role, cost_usd,
          pricing_source, pricing_version, five_hour_used_pct, weekly_used_pct, source_file
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const executionResult = statement.run(
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
        resolvedAgentRole,
        calculatedCostUsd,
        pricingSource,
        pricingVersion,
        record.fiveHourUsedPercent ?? record.fiveHourUsedPct ?? null,
        record.weeklyUsedPercent ?? record.weeklyUsedPct ?? null,
        record.sourceFile || null
      );

      return executionResult.changes > 0;
    } catch {
      return false;
    }
  }

  /**
   * 批次寫入消耗紀錄 (使用交易保證效能)
   */
  public insertBatch(
    records: TokenRecord[],
    onInserted?: (record: TokenRecord) => void,
    options: { updateExistingMetadata?: boolean } = {}
  ): number {
    if (records.length === 0) return 0;
    const database = this.ensureDatabase();
    let insertedRecordCount = 0;

    database.runTransaction(() => {
      const statement = database.prepare(`
        INSERT OR IGNORE INTO token_records (
          timestamp, datetime, session_id, thread_id, turn_id, response_id,
          model, input_tokens, cached_input_tokens, output_tokens,
          reasoning_output_tokens, total_tokens, agent_role, cost_usd,
          pricing_source, pricing_version, five_hour_used_pct, weekly_used_pct, source_file
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const updateRoleStatement = options.updateExistingMetadata
        ? database.prepare(`
            UPDATE token_records
            SET agent_role = ?
            WHERE session_id = ? AND turn_id = ? AND model = ? AND timestamp = ?
              AND agent_role = 'unknown'
              AND ? IN ('main', 'subagent')
          `)
        : null;

      for (const singleRecord of records) {
        const costResult = calculateTokenCost(
          singleRecord.model,
          singleRecord.inputTokens,
          singleRecord.cachedInputTokens,
          singleRecord.outputTokens,
          singleRecord.reasoningOutputTokens
        );

        const calculatedCostUsd =
          singleRecord.costUsd == null || !Number.isFinite(singleRecord.costUsd)
            ? costResult.totalCost
            : singleRecord.costUsd;
        const resolvedAgentRole = normalizeAgentRole(singleRecord.agentRole);
        const pricingSource = singleRecord.costUsd == null || !Number.isFinite(singleRecord.costUsd)
          ? costResult.pricingSource
          : normalizePricingSource(singleRecord.pricingSource);
        const pricingVersion = singleRecord.costUsd == null || !Number.isFinite(singleRecord.costUsd)
          ? costResult.pricingVersion
          : normalizePricingVersion(singleRecord.pricingVersion);

        const executionResult = statement.run(
          singleRecord.timestamp,
          singleRecord.datetime,
          singleRecord.sessionId,
          singleRecord.threadId,
          singleRecord.turnId,
          singleRecord.responseId || null,
          singleRecord.model,
          singleRecord.inputTokens,
          singleRecord.cachedInputTokens,
          singleRecord.outputTokens,
          singleRecord.reasoningOutputTokens,
          singleRecord.totalTokens,
          resolvedAgentRole,
          calculatedCostUsd,
          pricingSource,
          pricingVersion,
          singleRecord.fiveHourUsedPercent ?? singleRecord.fiveHourUsedPct ?? null,
          singleRecord.weeklyUsedPercent ?? singleRecord.weeklyUsedPct ?? null,
          singleRecord.sourceFile || null
        );

        if (executionResult.changes > 0) {
          insertedRecordCount += 1;
          onInserted?.(singleRecord);
        } else if (updateRoleStatement) {
          updateRoleStatement.run(
            resolvedAgentRole,
            singleRecord.sessionId,
            singleRecord.turnId,
            singleRecord.model,
            singleRecord.timestamp,
            resolvedAgentRole
          );
        }
      }
    });

    return insertedRecordCount;
  }

  /**
   * 取得檔案掃描游標紀錄
   */
  public getCursor(filePath: string): { mtime: number; size: number; recordsCount: number } | null {
    const database = this.ensureDatabase();
    const row = database.prepare(
      "SELECT mtime, size, records_count FROM file_scan_cursor WHERE file_path = ?"
    ).get(filePath);

    if (!row) return null;
    return {
      mtime: Number(row.mtime),
      size: Number(row.size),
      recordsCount: Number(row.records_count),
    };
  }

  /**
   * 更新檔案掃描游標 (使用 UPSERT 保證原子性)
   */
  public updateCursor(filePath: string, mtime: number, size: number, recordsCount: number): void {
    const database = this.ensureDatabase();
    const statement = database.prepare(`
      INSERT INTO file_scan_cursor (file_path, mtime, size, last_scanned_at, records_count)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(file_path) DO UPDATE SET
        mtime = excluded.mtime,
        size = excluded.size,
        last_scanned_at = excluded.last_scanned_at,
        records_count = excluded.records_count
    `);
    statement.run(filePath, mtime, size, Date.now(), recordsCount);
  }

  /**
   * 寫入 OpenAI 配額重置或重置券事件
   */
  public insertResetEvent(event: QuotaResetEvent): boolean {
    const database = this.ensureDatabase();
    try {
      const statement = database.prepare(`
        INSERT INTO quota_reset_events (
          timestamp, datetime, event_type, previous_five_hour_used_pct,
          new_five_hour_used_pct, previous_weekly_used_pct, new_weekly_used_pct,
          available_credits, credit_delta, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const executionResult = statement.run(
        event.timestamp,
        event.datetime,
        event.eventType,
        event.previousFiveHourUsedPercent,
        event.newFiveHourUsedPercent,
        event.previousWeeklyUsedPercent,
        event.newWeeklyUsedPercent,
        event.availableCredits,
        event.creditDelta,
        event.description
      );

      return executionResult.changes > 0;
    } catch {
      return false;
    }
  }

  /**
   * 查詢最近的配額重置事件歷史
   */
  public getResetEvents(limitCount = 20): QuotaResetEvent[] {
    const database = this.ensureDatabase();
    const rows = database.prepare(`
      SELECT
        id, timestamp, datetime, event_type, previous_five_hour_used_pct,
        new_five_hour_used_pct, previous_weekly_used_pct, new_weekly_used_pct,
        available_credits, credit_delta, description
      FROM quota_reset_events
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limitCount);

    return rows.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      datetime: row.datetime,
      eventType: row.event_type,
      previousFiveHourUsedPercent: row.previous_five_hour_used_pct,
      newFiveHourUsedPercent: row.new_five_hour_used_pct,
      previousWeeklyUsedPercent: row.previous_weekly_used_pct,
      newWeeklyUsedPercent: row.new_weekly_used_pct,
      availableCredits: row.available_credits,
      creditDelta: row.credit_delta,
      description: row.description || "",
    }));
  }

  /**
   * 寫入 OpenAI 方案變更事件 (升級、降級、方案切換紀錄)
   */
  public insertPlanChangeEvent(event: PlanChangeEvent): boolean {
    const database = this.ensureDatabase();
    try {
      const statement = database.prepare(`
        INSERT INTO plan_change_events (
          timestamp, datetime, previous_plan, new_plan, change_type, description
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      const executionResult = statement.run(
        event.timestamp,
        event.datetime,
        event.previousPlan,
        event.newPlan,
        event.changeType,
        event.description
      );

      return executionResult.changes > 0;
    } catch {
      return false;
    }
  }

  /**
   * 查詢方案變更歷史事件紀錄
   */
  public getPlanChangeEvents(limitCount = 20): PlanChangeEvent[] {
    const database = this.ensureDatabase();
    const rows = database.prepare(`
      SELECT id, timestamp, datetime, previous_plan, new_plan, change_type, description
      FROM plan_change_events
      ORDER BY timestamp DESC
      LIMIT ?
    `).all(limitCount);

    return rows.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      datetime: row.datetime,
      previousPlan: row.previous_plan,
      newPlan: row.new_plan,
      changeType: row.change_type as any,
      description: row.description || "",
    }));
  }

  /**
   * 查詢消耗流水帳紀錄 (支援分頁與模型、子代理人篩選)
   */
  public queryRecords(options: FilterOptions = {}): { total: number; records: TokenRecord[] } {
    const database = this.ensureDatabase();
    const conditions: string[] = [];
    const queryParameters: any[] = [];

    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    if (options.sinceMs !== undefined) {
      conditions.push("timestamp >= ?");
      queryParameters.push(options.sinceMs);
    }

    if (options.model) {
      conditions.push("model LIKE ?");
      queryParameters.push(`%${options.model}%`);
    }

    if (options.sessionId) {
      conditions.push("session_id = ?");
      queryParameters.push(options.sessionId);
    }

    if (options.agentRole) {
      conditions.push("agent_role = ?");
      queryParameters.push(options.agentRole);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRow = database.prepare(`SELECT COUNT(*) as count FROM token_records ${whereClause}`).get(...queryParameters);
    const total = Number(countRow?.count ?? 0);

    const querySql = `
      SELECT
        id, timestamp, datetime, session_id, thread_id, turn_id, response_id,
        model, input_tokens, cached_input_tokens, output_tokens,
        reasoning_output_tokens, total_tokens, agent_role, cost_usd,
        pricing_source, pricing_version, five_hour_used_pct, weekly_used_pct, source_file
      FROM token_records
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `;
    const rows = database.prepare(querySql).all(...queryParameters, limit, offset);

    const records: TokenRecord[] = rows.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      datetime: row.datetime,
      sessionId: row.session_id,
      threadId: row.thread_id,
      turnId: row.turn_id,
      responseId: row.response_id || undefined,
      model: row.model,
      inputTokens: row.input_tokens,
      cachedInputTokens: row.cached_input_tokens,
      outputTokens: row.output_tokens,
      reasoningOutputTokens: row.reasoning_output_tokens,
      totalTokens: row.total_tokens,
      agentRole: normalizeAgentRole(row.agent_role),
      costUsd: Number(row.cost_usd ?? 0),
      pricingSource: normalizePricingSource(row.pricing_source),
      pricingVersion: normalizePricingVersion(row.pricing_version),
      fiveHourUsedPercent: row.five_hour_used_pct,
      weeklyUsedPercent: row.weekly_used_pct,
      fiveHourUsedPct: row.five_hour_used_pct,
      weeklyUsedPct: row.weekly_used_pct,
      sourceFile: row.source_file,
    }));

    return { total, records };
  }

  /**
   * 取得指定時間範圍內的消耗彙總 (包含 subAgent 與等值美元花費)
   */
  public getSummary(sinceMs?: number): UsageSummary {
    const database = this.ensureDatabase();
    const whereClause = sinceMs !== undefined ? "WHERE timestamp >= ?" : "";
    const queryParameters = sinceMs !== undefined ? [sinceMs] : [];

    // 總體統計與 subagent 分離統計 (透過條件聚合單次查詢，杜絕多餘全表掃描)
    const totalRow = database.prepare(`
      SELECT
        COUNT(*) as requests,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(cached_input_tokens), 0) as cached_input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(reasoning_output_tokens), 0) as reasoning_output_tokens,
        COALESCE(SUM(CASE WHEN agent_role = 'main' THEN total_tokens ELSE 0 END), 0) as main_agent_tokens,
        COALESCE(SUM(CASE WHEN agent_role = 'subagent' THEN total_tokens ELSE 0 END), 0) as subagent_tokens,
        COALESCE(SUM(CASE WHEN agent_role = 'unknown' THEN total_tokens ELSE 0 END), 0) as unknown_agent_tokens,
        COALESCE(SUM(cost_usd), 0) as total_cost_usd,
        MIN(timestamp) as min_timestamp,
        MAX(timestamp) as max_timestamp
      FROM token_records
      ${whereClause}
    `).get(...queryParameters);

    const modelRows = database.prepare(`
      SELECT
        model,
        COUNT(*) as requests,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(cached_input_tokens), 0) as cached_input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(reasoning_output_tokens), 0) as reasoning_output_tokens,
        COALESCE(SUM(cost_usd), 0) as cost_usd
      FROM token_records
      ${whereClause}
      GROUP BY model
      ORDER BY total_tokens DESC
    `).all(...queryParameters);

    const pricingProvenanceRows = database.prepare(`
      SELECT
        pricing_source,
        pricing_version,
        COUNT(*) as records
      FROM token_records
      ${whereClause}
      GROUP BY pricing_source, pricing_version
      ORDER BY records DESC, pricing_source ASC, pricing_version ASC
    `).all(...queryParameters);

    const byModel: ModelUsageStats[] = modelRows.map((row: any) => ({
      model: row.model,
      requests: Number(row.requests),
      inputTokens: Number(row.input_tokens),
      cachedInputTokens: Number(row.cached_input_tokens),
      outputTokens: Number(row.output_tokens),
      reasoningOutputTokens: Number(row.reasoning_output_tokens),
      totalTokens: Number(row.total_tokens),
      costUsd: Number(row.cost_usd ?? 0),
    }));

    // 計算過去 1 小時滾動視窗真實燃燒率
    const oneHourAgoMs = Date.now() - 3600 * 1000;
    const burnRow = database.prepare(`
      SELECT COALESCE(SUM(total_tokens), 0) as tokens_in_last_hour
      FROM token_records
      WHERE timestamp >= ?
    `).get(oneHourAgoMs);

    const hourlyBurnRate = Number(burnRow?.tokens_in_last_hour ?? 0);
    const startMs = Number(totalRow?.min_timestamp ?? Date.now());
    const endMs = Number(totalRow?.max_timestamp ?? Date.now());

    const totalCostUsd = Number(totalRow?.total_cost_usd ?? 0);
    const formattedCostUsd = totalCostUsd < 0.01 && totalCostUsd > 0
      ? `$${totalCostUsd.toFixed(4)}`
      : `$${totalCostUsd.toFixed(2)}`;

    const totalTokenCount = Number(totalRow?.total_tokens ?? 0);
    const mainAgentTokenCount = Number(totalRow?.main_agent_tokens ?? 0);
    const subAgentTokenCount = Number(totalRow?.subagent_tokens ?? 0);
    const unknownAgentTokenCount = Number(totalRow?.unknown_agent_tokens ?? 0);

    return {
      requests: Number(totalRow?.requests ?? 0),
      totalTokens: totalTokenCount,
      inputTokens: Number(totalRow?.input_tokens ?? 0),
      cachedInputTokens: Number(totalRow?.cached_input_tokens ?? 0),
      outputTokens: Number(totalRow?.output_tokens ?? 0),
      reasoningOutputTokens: Number(totalRow?.reasoning_output_tokens ?? 0),
      mainAgentTokens: mainAgentTokenCount,
      subAgentTokens: subAgentTokenCount,
      unknownAgentTokens: unknownAgentTokenCount,
      estimatedCostUsd: totalCostUsd,
      formattedCostUsd,
      pricingProvenance: mapPricingProvenanceRows(pricingProvenanceRows),
      byModel,
      hourlyBurnRate,
      timeRange: { startMs, endMs },
    };
  }

  /**
   * 取得每小時 Token 消耗統計 (24小時趨勢)
   */
  public getHourlyStats(hours = 24): Array<{ hour: string; tokens: number; requests: number }> {
    const database = this.ensureDatabase();
    const sinceMs = Date.now() - hours * 3600 * 1000;

    const rows = database.prepare(`
      SELECT
        strftime('%Y-%m-%d %H:00', datetime, 'localtime') as hour,
        COALESCE(SUM(total_tokens), 0) as tokens,
        COUNT(*) as requests
      FROM token_records
      WHERE timestamp >= ?
      GROUP BY hour
      ORDER BY hour ASC
    `).all(sinceMs);

    return rows.map((row: any) => ({
      hour: row.hour,
      tokens: Number(row.tokens),
      requests: Number(row.requests),
    }));
  }

  /**
   * 多週期結算體系 (支援每日、每週、每月、每年結算)
   */
  public getSettlementRecords(
    periodType: "daily" | "weekly" | "monthly" | "yearly",
    limitCount = 30
  ): SettlementRecord[] {
    const database = this.ensureDatabase();

    // 以當週週一日期 (YYYY-MM-DD) 作為週期鍵；%w 為 0=週日，避免 %Y-W%W 的週 00 與非 ISO 問題
    const mondayWeekStartSql =
      "date(julianday(datetime, 'localtime') - ((strftime('%w', datetime, 'localtime') + 6) % 7))";

    let periodKeySql = "strftime('%Y-%m-%d', datetime, 'localtime')";
    if (periodType === "weekly") {
      periodKeySql = mondayWeekStartSql;
    } else if (periodType === "monthly") {
      periodKeySql = "strftime('%Y-%m', datetime, 'localtime')";
    } else if (periodType === "yearly") {
      periodKeySql = "strftime('%Y', datetime, 'localtime')";
    }

    const startDateSql = periodType === "weekly" ? mondayWeekStartSql : "MIN(datetime)";

    const querySql = `
      SELECT
        ${periodKeySql} as period_key,
        ${startDateSql} as start_date,
        MAX(datetime) as end_date,
        COUNT(*) as requests,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(cached_input_tokens), 0) as cached_input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(reasoning_output_tokens), 0) as reasoning_output_tokens,
        COALESCE(SUM(CASE WHEN agent_role = 'main' THEN total_tokens ELSE 0 END), 0) as main_agent_tokens,
        COALESCE(SUM(CASE WHEN agent_role = 'subagent' THEN total_tokens ELSE 0 END), 0) as subagent_tokens,
        COALESCE(SUM(CASE WHEN agent_role = 'unknown' THEN total_tokens ELSE 0 END), 0) as unknown_agent_tokens,
        COALESCE(SUM(cost_usd), 0) as estimated_cost_usd
      FROM token_records
      GROUP BY period_key
      ORDER BY period_key DESC
      LIMIT ?
    `;

    const rows = database.prepare(querySql).all(limitCount);

    const pricingProvenanceRows = database.prepare(`
      SELECT
        ${periodKeySql} as period_key,
        pricing_source,
        pricing_version,
        COUNT(*) as records
      FROM token_records
      GROUP BY period_key, pricing_source, pricing_version
      ORDER BY period_key DESC, records DESC, pricing_source ASC, pricing_version ASC
    `).all();
    const pricingProvenanceMap = new Map<string, PricingProvenanceBreakdown[]>();
    for (const item of pricingProvenanceRows) {
      const breakdown = pricingProvenanceMap.get(item.period_key) || [];
      breakdown.push(...mapPricingProvenanceRows([item]));
      pricingProvenanceMap.set(item.period_key, breakdown);
    }

    // 單次查詢批次取得各週期使用量第一名模型，杜絕 N+1 查詢問題
    const topModelRows = database.prepare(`
      WITH RankedModels AS (
        SELECT
          ${periodKeySql} as period_key,
          model,
          ROW_NUMBER() OVER (
            PARTITION BY ${periodKeySql}
            ORDER BY SUM(total_tokens) DESC
          ) as rank_num
        FROM token_records
        GROUP BY period_key, model
      )
      SELECT period_key, model
      FROM RankedModels
      WHERE rank_num = 1
    `).all();

    const topModelMap = new Map<string, string>();
    for (const item of topModelRows) {
      topModelMap.set(item.period_key, item.model);
    }

    return rows.map((row: any) => {
      const estimatedCostUsd = Number(row.estimated_cost_usd ?? 0);
      const formattedCostUsd = estimatedCostUsd < 0.01 && estimatedCostUsd > 0
        ? `$${estimatedCostUsd.toFixed(4)}`
        : `$${estimatedCostUsd.toFixed(2)}`;

      const totalTokens = Number(row.total_tokens);
      const mainAgentTokens = Number(row.main_agent_tokens);
      const subAgentTokens = Number(row.subagent_tokens);
      const unknownAgentTokens = Number(row.unknown_agent_tokens);

      return {
        periodKey: row.period_key,
        startDate: row.start_date,
        endDate: row.end_date,
        requests: Number(row.requests),
        totalTokens,
        inputTokens: Number(row.input_tokens),
        cachedInputTokens: Number(row.cached_input_tokens),
        outputTokens: Number(row.output_tokens),
        reasoningOutputTokens: Number(row.reasoning_output_tokens),
        mainAgentTokens,
        subAgentTokens,
        unknownAgentTokens,
        estimatedCostUsd,
        formattedCostUsd,
        pricingProvenance: pricingProvenanceMap.get(row.period_key) || [],
        topModel: topModelMap.get(row.period_key) || "gpt-6-astra",
      };
    });
  }

  /**
   * 取得最新一筆消耗紀錄 (明確指定欄位，杜絕 SELECT *)
   */
  public getLatestRecord(): TokenRecord | null {
    const database = this.ensureDatabase();
    const row = database.prepare(`
      SELECT
        id, timestamp, datetime, session_id, thread_id, turn_id, response_id,
        model, input_tokens, cached_input_tokens, output_tokens,
        reasoning_output_tokens, total_tokens, agent_role, cost_usd,
        pricing_source, pricing_version, five_hour_used_pct, weekly_used_pct, source_file
      FROM token_records
      ORDER BY timestamp DESC
      LIMIT 1
    `).get();

    if (!row) return null;

    return {
      id: row.id,
      timestamp: row.timestamp,
      datetime: row.datetime,
      sessionId: row.session_id,
      threadId: row.thread_id,
      turnId: row.turn_id,
      responseId: row.response_id || undefined,
      model: row.model,
      inputTokens: row.input_tokens,
      cachedInputTokens: row.cached_input_tokens,
      outputTokens: row.output_tokens,
      reasoningOutputTokens: row.reasoning_output_tokens,
      totalTokens: row.total_tokens,
      agentRole: normalizeAgentRole(row.agent_role),
      costUsd: Number(row.cost_usd ?? 0),
      pricingSource: normalizePricingSource(row.pricing_source),
      pricingVersion: normalizePricingVersion(row.pricing_version),
      fiveHourUsedPercent: row.five_hour_used_pct,
      weeklyUsedPercent: row.weekly_used_pct,
      fiveHourUsedPct: row.five_hour_used_pct,
      weeklyUsedPct: row.weekly_used_pct,
      sourceFile: row.source_file,
    };
  }

  /**
   * 依據目前生效的定價設定檔，批次重新計算並更新資料表中所有紀錄的 cost_usd
   */
  public recalculateAllCosts(): number {
    const database = this.ensureDatabase();
    const rows = database.prepare(`
      SELECT id, model, input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens
      FROM token_records
    `).all();

    let updatedCount = 0;
    database.runTransaction(() => {
      const updateStatement = database.prepare(`
        UPDATE token_records
        SET cost_usd = ?, pricing_source = ?, pricing_version = ?
        WHERE id = ?
      `);

      for (const singleRow of rows) {
        const costResult = calculateTokenCost(
          singleRow.model,
          Number(singleRow.input_tokens),
          Number(singleRow.cached_input_tokens),
          Number(singleRow.output_tokens),
          Number(singleRow.reasoning_output_tokens)
        );

        updateStatement.run(
          costResult.totalCost,
          costResult.pricingSource,
          costResult.pricingVersion,
          singleRow.id
        );
        updatedCount += 1;
      }
    });

    return updatedCount;
  }

  public close(): void {
    if (this.databaseInstance) {
      this.databaseInstance.close();
      this.databaseInstance = null;
    }
  }
}
