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
  transaction<T>(fn: () => T): T;
  close(): void;
}

export async function createSqliteDb(filePath: string): Promise<SqliteDb> {
  const isBun = typeof (globalThis as any).Bun !== "undefined";

  if (isBun) {
    const { Database } = await import("bun:sqlite");
    const db = new Database(filePath);
    db.run("PRAGMA journal_mode = WAL;");
    db.run("PRAGMA synchronous = NORMAL;");

    return {
      exec(sql: string): void {
        db.run(sql);
      },
      prepare(sql: string): PreparedStatement {
        const stmt = db.query(sql);
        return {
          run(...params: any[]) {
            const res = stmt.run(...params);
            return { changes: res.changes, lastInsertRowid: res.lastInsertRowid };
          },
          all(...params: any[]) {
            return stmt.all(...params);
          },
          get(...params: any[]) {
            return stmt.get(...params);
          },
        };
      },
      transaction<T>(fn: () => T): T {
        const tx = db.transaction(fn);
        return tx();
      },
      close(): void {
        db.close();
      },
    };
  } else {
    // Node.js 22+ 內建 node:sqlite
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(filePath);
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA synchronous = NORMAL;");

    return {
      exec(sql: string): void {
        db.exec(sql);
      },
      prepare(sql: string): PreparedStatement {
        const stmt = db.prepare(sql);
        return {
          run(...params: any[]) {
            const res = stmt.run(...params);
            return {
              changes: Number(res.changes ?? 0),
              lastInsertRowid: res.lastInsertRowid ?? 0,
            };
          },
          all(...params: any[]) {
            return stmt.all(...params);
          },
          get(...params: any[]) {
            return stmt.get(...params);
          },
        };
      },
      transaction<T>(fn: () => T): T {
        db.exec("BEGIN TRANSACTION;");
        try {
          const result = fn();
          db.exec("COMMIT;");
          return result;
        } catch (error) {
          db.exec("ROLLBACK;");
          throw error;
        }
      },
      close(): void {
        db.close();
      },
    };
  }
}
