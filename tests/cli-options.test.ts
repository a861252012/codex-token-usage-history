import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("dashboard rejects malformed ports before opening a listener", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-cli-options-"));
  writeFileSync(join(directory, "pricing_cache.json"), JSON.stringify({ schemaVersion: 2, updatedAtMs: Date.now(), models: [] }));
  const preload = join(directory, "offline.ts");
  writeFileSync(preload, 'globalThis.fetch = async () => { throw new Error("offline fixture"); };');
  try {
    for (const port of ["10200abc", "1.5", "-1", "65536", ""]) {
      const result = spawnSync(process.execPath, ["--preload", preload, "src/cli/index.ts", "dashboard", "--no-open", `--port=${port}`], {
        cwd: join(import.meta.dir, ".."), env: { ...process.env, CODEX_HOME: directory }, encoding: "utf8", timeout: 5000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("port 必須");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("unknown commands fail before creating data or fetching", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-cli-unknown-"));
  const dataDirectory = join(directory, "data");
  const fetchMarker = join(directory, "fetch-called");
  const preload = join(directory, "offline.ts");
  writeFileSync(preload, `import { writeFileSync } from "node:fs";
    globalThis.fetch = async () => { writeFileSync(${JSON.stringify(fetchMarker)}, "called"); throw new Error("offline fixture"); };`);
  try {
    const result = spawnSync(process.execPath, ["--preload", preload, "src/cli/index.ts", "histroy", "--json"], {
      cwd: join(import.meta.dir, ".."), env: { ...process.env, CODEX_HOME: dataDirectory }, encoding: "utf8", timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("未知命令: histroy");
    expect(result.stdout).toBe("");
    expect(existsSync(dataDirectory)).toBe(false);
    expect(existsSync(fetchMarker)).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("explicit pricing update fails with nonzero status and preserves the previous cache", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-cli-pricing-"));
  const preload = join(directory, "offline.ts");
  const cachePath = join(directory, "pricing_cache.json");
  const previousCache = JSON.stringify({ updatedAtMs: Date.now(), models: [] });
  writeFileSync(cachePath, previousCache);
  writeFileSync(preload, 'globalThis.fetch = async () => { throw new Error("offline fixture"); };');
  try {
    const result = spawnSync(process.execPath, ["--preload", preload, "src/cli/index.ts", "pricing", "update"], {
      cwd: join(import.meta.dir, ".."), env: { ...process.env, CODEX_HOME: directory }, encoding: "utf8", timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("offline fixture");
    expect(readFileSync(cachePath, "utf8")).toBe(previousCache);
    expect(existsSync(join(directory, "token_usage_history.sqlite"))).toBe(false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
