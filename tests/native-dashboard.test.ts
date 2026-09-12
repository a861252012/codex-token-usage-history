import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const hud = readFileSync(new URL("../src/floating-hud/main.swift", import.meta.url), "utf8");
const menubar = readFileSync(new URL("../src/menubar/main.swift", import.meta.url), "utf8");

test.skipIf(process.platform !== "darwin")("native dashboard checks canonical profiles and launches the adjacent CLI without global installation", () => {
  const profileCheck = hud.slice(hud.indexOf("func dashboardMatchesProfile"), hud.indexOf("func acquireHudLock"));
  const launcher = hud.slice(hud.indexOf("func makeDashboardProcess"), hud.indexOf("struct HudLoginItem"));
  const menuProfileCheck = menubar.slice(menubar.indexOf("func dashboardMatchesProfile"), menubar.indexOf("// 型別結構定義"));
  expect(menuProfileCheck.trim()).toBe(profileCheck.trim());
  const result = spawnSync("swift", ["-"], {
    input: `import Foundation
${profileCheck}
${launcher}
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: root) }
let profile = root.appendingPathComponent("profile with spaces")
try FileManager.default.createDirectory(at: profile, withIntermediateDirectories: true)
let alias = root.appendingPathComponent("alias")
try FileManager.default.createSymbolicLink(at: alias, withDestinationURL: profile)
assert(dashboardMatchesProfile(profile.path, alias.path))
assert(!dashboardMatchesProfile(root.appendingPathComponent("other").path, profile.path))
assert(!dashboardMatchesProfile(nil, profile.path))
assert(!dashboardMatchesProfile("", profile.path))
let cli = root.appendingPathComponent("codex-usage")
try "#!/bin/sh\\nprintf '%s\\\\n' \\"$CODEX_HOME\\" \\"$@\\" > \\"$CODEX_HOME/invocation\\"\\n".write(to: cli, atomically: true, encoding: .utf8)
try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: cli.path)
setenv("PATH", "/usr/bin:/bin", 1)
let process = try makeDashboardProcess(executableURL: root.appendingPathComponent("codex-hud"), codexDirectory: alias.path)
assert(process.executableURL == cli)
assert(process.arguments == ["dashboard"])
assert(process.environment?["PATH"]?.contains("/opt/homebrew/bin") == true)
assert(process.environment?["PATH"]?.contains("/.bun/bin") == true)
try process.run()
process.waitUntilExit()
assert(process.terminationStatus == 0)
let invocation = try String(contentsOf: profile.appendingPathComponent("invocation"), encoding: .utf8)
assert(invocation == profile.resolvingSymlinksInPath().path + "\\ndashboard\\n")
do {
    _ = try makeDashboardProcess(executableURL: root.appendingPathComponent("missing/codex-hud"), codexDirectory: profile.path)
    fatalError("Missing CLI must fail")
} catch {}
print("PASS")
`, encoding: "utf8", timeout: 60_000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("PASS");
}, 65_000);

test("both HTTP consumers require profile identity and menubar uses the formatted currency unchanged", () => {
  expect(hud).toContain("dashboardMatchesProfile(decodedStatus.dataDirectory, self.codexDirectoryPath)");
  expect(menubar).toContain("dashboardMatchesProfile(fullStatus.dataDirectory, self.codexDirectoryPath)");
  expect(hud).toContain('dashboardMatchesProfile(diagnostics["dataDirectory"] as? String, self.codexDirectoryPath)');
  expect(menubar).toContain('dashboardMatchesProfile(diagnostics["dataDirectory"] as? String, self.codexDirectoryPath)');
  for (const source of [hud, menubar]) {
    expect(source).toContain('url.appendingPathComponent("api/diagnostics")');
  }
  expect(menubar).toContain('" (~\\(todaySummary.formattedCostUsd!) USD)"');
  expect(menubar).not.toContain('" (~$\\(todaySummary.formattedCostUsd!) USD)"');
});
