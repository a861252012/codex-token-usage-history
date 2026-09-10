import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("doctor is read-only even for a nonexistent data directory and never fetches", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-doctor-"));
  const missing = join(directory, "missing");
  const preload = join(directory, "offline.ts");
  writeFileSync(preload, `import { writeFileSync } from "node:fs"; globalThis.fetch = () => { writeFileSync(${JSON.stringify(join(directory, "fetch-called"))}, "called"); throw new Error("doctor must not fetch"); };`);
  try {
    const result = spawnSync(process.execPath, ["--preload", preload, "src/cli/index.ts", "doctor", "--json"], {
      cwd: join(import.meta.dir, ".."), env: { ...process.env, CODEX_HOME: missing }, encoding: "utf8", timeout: 10000,
    });
    expect(result.status).toBe(0);
    const diagnostic = JSON.parse(result.stdout);
    expect(diagnostic.authenticationVerified).toBe(false);
    expect(diagnostic.paths.every((path: { status: string }) => path.status === "missing")).toBe(true);
    expect(existsSync(missing)).toBe(false);
    expect(readdirSync(directory)).toEqual(["offline.ts"]);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
