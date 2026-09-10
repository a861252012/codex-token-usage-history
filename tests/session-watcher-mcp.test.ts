import { describe, test, expect } from "bun:test";
import { writeFileSync, mkdirSync, rmSync, existsSync, utimesSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { SessionWatcher } from "../src/core/session-watcher.js";
import { syncPricingFromUpstream } from "../src/core/pricing-sync.js";
import { HistoryDatabase } from "../src/core/history-db.js";
import { SessionIndexer } from "../src/core/session-indexer.js";

describe("Watcher, MCP, Pricing, and Subprocess regression tests", () => {
  test("SessionWatcher 定時輪詢掃描到新紀錄時必須發送 newRecords 事件", async () => {
    let scans = 0;
    const mockIndexer = {
      indexRecent: () => {
        scans++;
        if (scans > 1) {
          return {
            filesScanned: 1,
            recordsInserted: 1,
            durationMs: 5,
            newRecords: [{ id: 1, totalTokens: 42 } as any],
          };
        }
        return { filesScanned: 0, recordsInserted: 0, durationMs: 1, newRecords: [] };
      },
    };
    const mockQuotaClient = {
      getQuotaSnapshot: async () => ({ source: "fallback" } as any),
    };

    const emptyDir = join(tmpdir(), `empty_watch_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    mkdirSync(emptyDir, { recursive: true });

    const watcher = new SessionWatcher(mockIndexer as any, mockQuotaClient as any, emptyDir);
    let newRecordsEvents = 0;
    let quotaEvents = 0;

    watcher.on("newRecords", () => newRecordsEvents++);
    watcher.on("quotaUpdated", () => quotaEvents++);

    watcher.start(20);
    await new Promise((resolve) => setTimeout(resolve, 65));
    watcher.stop();
    rmSync(emptyDir, { recursive: true, force: true });

    expect(scans).toBeGreaterThan(1);
    expect(newRecordsEvents).toBeGreaterThanOrEqual(1);
    expect(quotaEvents).toBeGreaterThanOrEqual(1);
  });

  test("SessionIndexer indexRecent 回傳包含 newRecords 陣列", async () => {
    const scratchDir = join(tmpdir(), `test_indexer_rec_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const todayDir = join(scratchDir, "sessions", String(today.getFullYear()), pad(today.getMonth() + 1), pad(today.getDate()));
    mkdirSync(todayDir, { recursive: true });

    const dbPath = join(scratchDir, "test.sqlite");
    const db = new HistoryDatabase(dbPath);
    await db.init();

    const sessionFile = join(todayDir, "session_test.jsonl");
    writeFileSync(sessionFile, [
      JSON.stringify({ type: "session_meta", payload: { id: "rec-1", provenance: { model: "gpt-5" } } }),
      JSON.stringify({
        type: "token_usage_record",
        timestamp: new Date().toISOString(),
        payload: { usage: { input_tokens: 100, output_tokens: 50, total_tokens: 150 } },
      }),
    ].join("\n"));

    const indexer = new SessionIndexer(db, scratchDir);
    const scanResult = indexer.indexRecent(1);

    expect(scanResult.recordsInserted).toBe(1);
    expect(scanResult.newRecords).toHaveLength(1);
    expect(scanResult.newRecords[0].totalTokens).toBe(150);

    db.close();
    rmSync(scratchDir, { recursive: true, force: true });
  });

  test("MCP 查詢前執行 indexAll 能涵蓋 7 天前 mtime 與 archived_sessions 舊記錄", async () => {
    const scratchDir = join(tmpdir(), `test_mcp_all_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const sessionsDir = join(scratchDir, "sessions", "2026", "08", "01");
    const archivedDir = join(scratchDir, "archived_sessions");
    mkdirSync(sessionsDir, { recursive: true });
    mkdirSync(archivedDir, { recursive: true });

    // 1. 超過 7 天前的舊 session (手動將 mtime 改為 14 天前)
    const oldSessionFile = join(sessionsDir, "old_sample.jsonl");
    writeFileSync(oldSessionFile, JSON.stringify({
      type: "token_usage_record",
      timestamp: new Date(Date.now() - 14 * 86400 * 1000).toISOString(),
      payload: { session_id: "old-session-1", thread_id: "main", usage: { input_tokens: 40, output_tokens: 10, total_tokens: 50 } },
    }));
    const fourteenDaysAgo = new Date(Date.now() - 14 * 86400 * 1000);
    utimesSync(oldSessionFile, fourteenDaysAgo, fourteenDaysAgo);

    // 2. archived_sessions 目錄下的 session
    const archivedSessionFile = join(archivedDir, "archived_sample.jsonl");
    writeFileSync(archivedSessionFile, JSON.stringify({
      type: "token_usage_record",
      timestamp: new Date(Date.now() - 30 * 86400 * 1000).toISOString(),
      payload: { session_id: "archived-session-1", thread_id: "main", usage: { input_tokens: 60, output_tokens: 20, total_tokens: 80 } },
    }));

    try {
      for (const toolName of ["get_codex_settlement_report", "get_codex_usage_history"]) {
        const proc = spawnSync(process.execPath, ["src/cli/index.ts", "mcp"], {
          cwd: join(import.meta.dir, ".."),
          env: { ...process.env, CODEX_HOME: scratchDir },
          input: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call",
            params: { name: toolName, arguments: { limit: 60 } } }) + "\n",
          encoding: "utf8", timeout: 5000,
        });
        expect(proc.status).toBe(0);
        const response = JSON.parse(proc.stdout.trim());
        expect(response.error).toBeUndefined();
        const result = JSON.parse(response.result.content[0].text);
        if (toolName === "get_codex_usage_history") {
          expect(result.recentRecordsTotal).toBe(2);
        } else {
          expect(result.count).toBe(2);
        }
      }
    } finally {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  test("子程序執行 prompt 指令不會觸發背景定價同步與 fetch", () => {
    const scratchDir = join(tmpdir(), `test_prompt_proc_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    mkdirSync(scratchDir, { recursive: true });

    const fetchMarker = join(scratchDir, "fetch-called");
    const preload = join(scratchDir, "offline.ts");
    writeFileSync(preload, `import { writeFileSync } from "node:fs";
      globalThis.fetch = async () => { writeFileSync(${JSON.stringify(fetchMarker)}, "called"); throw new Error("offline"); };`);
    const proc = spawnSync(process.execPath, ["--preload", preload, "src/cli/index.ts", "prompt"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        CODEX_HOME: scratchDir,
      },
      encoding: "utf-8",
      timeout: 5000,
    });

    expect(proc.status).toBe(0);
    expect(proc.stdout.trim()).toContain("[Codex");

    // 驗證未建立 pricing_cache.json (完全不觸發 triggerBackgroundPricingSync)
    const pricingCachePath = join(scratchDir, "pricing_cache.json");
    expect(existsSync(pricingCachePath)).toBe(false);
    expect(existsSync(fetchMarker)).toBe(false);

    rmSync(scratchDir, { recursive: true, force: true });
  });

  test("syncPricingFromUpstream 明確 await 錯誤時仍會確實清理 timeout timer", async () => {
    const originalFetch = globalThis.fetch;
    const originalClearTimeout = globalThis.clearTimeout;
    let clearedTimerId: any = null;

    try {
      globalThis.clearTimeout = (handle: any) => {
        clearedTimerId = handle;
        return originalClearTimeout(handle);
      };

      globalThis.fetch = async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        throw new Error("simulated network abort");
      };

      const result = await syncPricingFromUpstream(true);
      expect(result.success).toBe(false);
      expect(result.source).toBe("error-fallback");
      expect(clearedTimerId).not.toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  test("install.sh 產出之 launchd plist 具備 XML escaping 與正確選取之 RUNTIME PATH (隔離驗證)", () => {
    const script = readFileSync(join(import.meta.dir, "../scripts/install.sh"), "utf8");
    const start = script.indexOf("xml_escape() {");
    const end = script.indexOf('\ncat << PLIST_EOF', start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const specialPath = '/tmp/my test & path <"special">';
    const result = spawnSync("/bin/bash", ["-c", script.slice(start, end) + '\nprintf "%s\n%s" "$ESCAPED_BIN" "$COMBINED_PATH"'], {
      env: { ...process.env, SCRIPT_DIRECTORY: specialPath }, encoding: "utf8",
    });
    expect(result.status).toBe(0);
    const [escaped, runtimePath] = result.stdout.split("\n");
    expect(escaped).toBe('/tmp/my test &amp; path &lt;&quot;special&quot;&gt;/bin/codex-usage');
    expect(runtimePath).toContain("/usr/bin:/bin:/usr/sbin:/sbin");
    const runtime = spawnSync("/bin/bash", ["-c", "command -v bun || command -v node"], {
      env: { PATH: runtimePath }, encoding: "utf8",
    });
    expect(runtime.status).toBe(0);
  });
});
