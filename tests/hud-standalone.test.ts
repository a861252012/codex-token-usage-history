import { expect, test } from "bun:test";
import { readFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const source = readFileSync(new URL("../src/floating-hud/main.swift", import.meta.url), "utf8");

test.skipIf(process.platform !== "darwin")("standalone HUD fetches quota through the adjacent CLI and rejects failed refreshes", () => {
  const functions = source.slice(source.indexOf("func makeDashboardProcess"), source.indexOf("struct HudLoginItem"));
  const types = source.slice(source.indexOf("struct WindowQuotaDTO:"), source.indexOf("struct PlanChangeEventDTO:"));
  const result = spawnSync("swift", ["-"], { input: `import Foundation
import Darwin
${types}
${functions}
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: root) }
let cli = root.appendingPathComponent("codex-usage")
let script = """
#!/bin/sh
[ "$1" = "quota" ] || exit 2
[ "$CODEX_HOME" = "${'$'}(dirname "$0")" ] || exit 3
printf '%s' '{"source":"wham","weekly":{"usedPercent":84,"remainingPercent":16,"resetCountdown":"1d"}}'
"""
try script.write(to: cli, atomically: true, encoding: .utf8)
try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: cli.path)
let executable = root.appendingPathComponent("codex-hud")
let snapshot = try fetchStandaloneQuota(executableURL: executable, codexDirectory: root.path)
assert(snapshot?.weekly?.remainingPercent == 16)
assert(snapshot?.source == "wham")
try "#!/bin/sh\\nexit 1\\n".write(to: cli, atomically: false, encoding: .utf8)
let failed = try fetchStandaloneQuota(executableURL: executable, codexDirectory: root.path)
assert(failed == nil)
print("PASS")
`, encoding: "utf8", timeout: 30_000 });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("PASS");
}, 35_000);

test("quota command returns JSON without creating or indexing a history database", () => {
  const root = mkdtempSync(join(tmpdir(), "hud-quota-"));
  try {
    const result = spawnSync(process.execPath, ["run", "src/cli/index.ts", "quota"], {
      env: { ...process.env, CODEX_HOME: root }, encoding: "utf8", timeout: 15_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).source).toBe("fallback");
    expect(readdirSync(root)).toEqual([]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
