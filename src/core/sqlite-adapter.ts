/**
 * 跨執行環境 (Node.js 22+ 與 Bun) 的輕量級 SQLite 資料庫配接器
 * 零外部相依套件，提供一致的同步資料庫操作介面
 */

export interface PreparedStatement {
  run(...params: any[]): { changes: number; lastInsertRowid: number | bigint };
  all(...params: any[]): any[];
  get(...params: any[]): any;
}

export interface SqliteDb {
  exec(sql: string): void;
  prepare(sql: string): PreparedStatement;
  runTransaction<T>(actionCallback: () => T): T;
  transaction<T>(actionCallback: () => T): T;
  close(): void;
}

export async function createSqliteDb(filePath: string): Promise<SqliteDb> {
  const bunRuntimeEnvironment = typeof (globalThis as any).Bun !== "undefined";

  if (bunRuntimeEnvironment) {
    // @ts-ignore
    const { Database } = await import("bun:sqlite");
    const database = new Database(filePath);
    database.run("PRAGMA journal_mode = WAL;");
    database.run("PRAGMA synchronous = NORMAL;");
    database.run("PRAGMA temp_store = MEMORY;");
    database.run("PRAGMA cache_size = -32000;");

    const runTransaction = <T>(actionCallback: () => T): T => {
      const transactionRunner = database.transaction(actionCallback);
      return transactionRunner();
    };

    return {
      exec(sql: string): void {
        database.run(sql);
      },
      prepare(sql: string): PreparedStatement {
        const statement = database.query(sql);
        return {
          run(...params: any[]) {
            const executionResult = statement.run(...params);
            return { changes: executionResult.changes, lastInsertRowid: executionResult.lastInsertRowid };
          },
          all(...params: any[]) {
            return statement.all(...params);
          },
          get(...params: any[]) {
            return statement.get(...params);
          },
        };
      },
      runTransaction,
      transaction: runTransaction,
      close(): void {
        database.close();
      },
    };
  } else {
    // Node.js 22+ 內建 node:sqlite
    const { DatabaseSync } = await import("node:sqlite");
    const database = new DatabaseSync(filePath);
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA synchronous = NORMAL;");
    database.exec("PRAGMA temp_store = MEMORY;");
    database.exec("PRAGMA cache_size = -32000;");

    const runTransaction = <T>(actionCallback: () => T): T => {
      database.exec("BEGIN TRANSACTION;");
      try {
        const actionResult = actionCallback();
        database.exec("COMMIT;");
        return actionResult;
      } catch (caughtError) {
        database.exec("ROLLBACK;");
        throw caughtError;
      }
    };

    return {
      exec(sql: string): void {
        database.exec(sql);
      },
      prepare(sql: string): PreparedStatement {
        const statement = database.prepare(sql);
        return {
          run(...params: any[]) {
            const executionResult = statement.run(...params);
            return {
              changes: Number(executionResult.changes ?? 0),
              lastInsertRowid: executionResult.lastInsertRowid ?? 0,
            };
          },
          all(...params: any[]) {
            return statement.all(...params);
          },
          get(...params: any[]) {
            return statement.get(...params);
          },
        };
      },
      runTransaction,
      transaction: runTransaction,
      close(): void {
        database.close();
      },
    };
  }
}
