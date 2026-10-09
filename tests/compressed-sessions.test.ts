import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HistoryDatabase } from "../src/core/history-db.js";
import { SessionIndexer } from "../src/core/session-indexer.js";

const hasZstd = spawnSync("zstd", ["--version"]).status === 0;

test.skipIf(!hasZstd)("compressed sessions preserve context, Unicode, original cursors and deduplication", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-zstd-test-"));
  const db = new HistoryDatabase(join(root, "history.sqlite"));
  try {
    await db.init();
    mkdirSync(join(root, "sessions"));
    mkdirSync(join(root, "archived_sessions"));
    const plain = join(root, "sessions", "session with spaces.jsonl");
    const compressed = join(root, "archived_sessions", "session with spaces.jsonl.zst");
    const content = [
      JSON.stringify({ type: "session_meta", payload: { id: "壓縮-session", source: { subagent: "test" }, provenance: { model: "gpt-5" } } }),
      // Exceed the default subprocess buffer without losing subsequent turn context.
      JSON.stringify({ type: "response_item", payload: { text: "中文".repeat(400_000) } }),
      JSON.stringify({ type: "turn_context", payload: { model: "gpt-4o", turn_id: "turn-a" } }),
      JSON.stringify({ type: "token_usage_record", timestamp: "2026-09-01T00:00:00Z", payload: { usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 } } }),
    ].join("\n");
    writeFileSync(plain, content);
    expect(spawnSync("zstd", ["-q", "-f", plain, "-o", compressed]).status).toBe(0);
    const originalBytes = readFileSync(compressed);
    const old = new Date("2020-01-01");
    utimesSync(compressed, old, old);
    const indexer = new SessionIndexer(db, root);
    expect(indexer.findJsonlFiles(root)).toHaveLength(2);
    const parsed = indexer.parseFile(compressed).records;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ sessionId: "壓縮-session", model: "gpt-4o", agentRole: "subagent", totalTokens: 24, sourceFile: compressed });
    expect(indexer.indexAll().recordsInserted).toBe(1);
    expect(indexer.getDiagnostics()).toMatchObject({ filesDiscovered: 2, filesRead: 2, filesFailed: 0 });
    expect(db.getCursor(compressed)?.size).toBe(originalBytes.length);
    expect(indexer.indexAll().recordsInserted).toBe(0);
    expect(indexer.getDiagnostics().filesUnchanged).toBe(2);
    expect(indexer.indexAll(true).recordsInserted).toBe(0);
    expect(db.getSummary().totalTokens).toBe(24);
    expect(readFileSync(compressed)).toEqual(originalBytes);
  } finally { db.close(); rmSync(root, { recursive: true, force: true }); }
});

test("missing zstd is an explicit recoverable failure and does not advance the cursor", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-zstd-missing-"));
  const db = new HistoryDatabase(join(root, "history.sqlite"));
  const oldPath = process.env.PATH;
  try {
    await db.init();
    const compressed = join(root, "sample.jsonl.zst");
    writeFileSync(compressed, "invalid compressed data");
    const indexer = new SessionIndexer(db, root);
    process.env.PATH = root;
    expect(indexer.indexFile(compressed).insertedCount).toBe(0);
    expect(indexer.getDiagnostics().filesFailed).toBe(1);
    expect(indexer.getDiagnostics().fileErrors[0].message).toContain("zstd executable not found");
    expect(db.getCursor(compressed)).toBeNull();
    process.env.PATH = oldPath;
    if (hasZstd) {
      expect(indexer.indexFile(compressed).insertedCount).toBe(0);
      expect(indexer.getDiagnostics().fileErrors[0].message).toContain("zstd decompression failed");
      expect(db.getCursor(compressed)).toBeNull();
    }
  } finally {
    if (oldPath === undefined) delete process.env.PATH; else process.env.PATH = oldPath;
    db.close(); rmSync(root, { recursive: true, force: true });
  }
});
