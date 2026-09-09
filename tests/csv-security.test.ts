import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("CSV export security", () => {
  test("CLI neutralizes formula strings without rewriting negative numbers", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-csv-security-"));
    const now = new Date();
    const sessionDirectory = join(
      directory,
      "sessions",
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    );
    mkdirSync(sessionDirectory, { recursive: true });
    writeFileSync(join(directory, "pricing_cache.json"), JSON.stringify({
      updatedAtMs: Date.now(),
      updatedDate: "test",
      modelCount: 0,
      models: [],
    }));
    writeFileSync(join(sessionDirectory, "formula.jsonl"), [
      JSON.stringify({ type: "session_meta", payload: { id: "@danger", provenance: { model: "=1+1" } } }),
      JSON.stringify({
        type: "token_usage_record",
        timestamp: now.toISOString(),
        payload: {
          session_id: "@danger",
          thread_id: "main",
          turn_id: "formula-test",
          usage: { input_tokens: -42, output_tokens: 0, total_tokens: -42 },
        },
      }),
    ].join("\n"));

    try {
      const result = spawnSync(process.execPath, ["src/cli/index.ts", "history", "--csv"], {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, CODEX_HOME: directory },
        encoding: "utf8",
        timeout: 5_000,
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const recordRow = result.stdout.trim().split("\n")[1];
      expect(recordRow).toContain(",'=1+1,main,-42,-42,");
      expect(recordRow).toEndWith(",'@danger");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("Web exporter neutralizes formula strings without rewriting numeric negatives", () => {
    const source = readFileSync(join(import.meta.dir, "../src/web/app.js"), "utf8");
    const functionSource = source.match(/function escapeCsvField\(fieldValue\) \{[\s\S]*?\n\}/)?.[0];
    expect(functionSource).toBeDefined();
    const escapeCsvField = Function(`${functionSource}; return escapeCsvField;`)() as (value: unknown) => string;

    expect(escapeCsvField(" \t=1+1")).toBe("' \t=1+1");
    expect(escapeCsvField("@danger")).toBe("'@danger");
    expect(escapeCsvField(-42)).toBe("-42");
  });
});
