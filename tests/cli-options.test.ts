import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("dashboard rejects malformed ports before opening a listener", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-cli-options-"));
  writeFileSync(join(directory, "pricing_cache.json"), JSON.stringify({ updatedAtMs: Date.now(), models: [] }));
  try {
    for (const port of ["10200abc", "1.5", "-1", "65536", ""]) {
      const result = spawnSync(process.execPath, ["src/cli/index.ts", "dashboard", "--no-open", `--port=${port}`], {
        cwd: join(import.meta.dir, ".."), env: { ...process.env, CODEX_HOME: directory }, encoding: "utf8", timeout: 5000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("port 必須");
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
