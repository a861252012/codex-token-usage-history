import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test.skipIf(process.platform !== "darwin")("HUD schedules default, bounded intervals and picks up changes", () => {
  const source = readFileSync(new URL("../src/floating-hud/main.swift", import.meta.url), "utf8");
  const method = source.slice(source.indexOf("    private func startPeriodicTimer()"), source.indexOf("    private func loadLatestData()"))
    .replace("private func", "func");
  const result = spawnSync("swift", ["-"], {
    input: `import Foundation
import CoreFoundation
class Scheduler {
    let codexDirectoryPath: String
    var refreshTimer: Timer?
    var refreshIntervalSeconds: TimeInterval = 5
    init(_ directory: String) { codexDirectoryPath = directory }
    func loadLatestData() {}
${method}
}
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: root) }
setenv("CODEX_HOME", root.path, 1)
let scheduler = Scheduler(root.path)
scheduler.startPeriodicTimer()
assert(scheduler.refreshIntervalSeconds == 5)
for (raw, expected) in [("1", 1.0), ("300", 300.0), ("0", 5.0), ("-1", 5.0), ("301", 5.0), ("1.5", 5.0), ("true", 5.0), ("null", 5.0), ("\\\"5\\\"", 5.0)] {
    try Data("{\\\"refreshIntervalSeconds\\\":\\(raw)}".utf8).write(to: root.appendingPathComponent("hud-settings.json"))
    scheduler.refreshTimer?.fire()
    assert(scheduler.refreshIntervalSeconds == expected)
}
scheduler.refreshTimer?.invalidate()
print("PASS")
`, encoding: "utf8", timeout: 60_000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("PASS");
}, 60_000);
