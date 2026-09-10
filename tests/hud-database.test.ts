import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test.skipIf(process.platform !== "darwin")("HUD uses read-only native SQLite and recovers off-screen panels", () => {
  const source = readFileSync(new URL("../src/floating-hud/main.swift", import.meta.url), "utf8");
  const databaseMethods = source.slice(source.indexOf("    private func queryDatabaseRow("), source.indexOf("    private func updateUserInterface("))
    .replaceAll("private func", "func");
  const screenMethod = source.slice(source.indexOf("    @objc private func screenParametersChanged()"), source.indexOf("    private func getConfigurationFilePath()"))
    .replace("@objc private func", "func");
  const result = spawnSync("swift", ["-"], {
    input: `import Cocoa
import SQLite3
${source.slice(source.indexOf("struct PlanChangeEventDTO:"), source.indexOf("struct FullStatusDTO:"))}
${source.slice(source.indexOf("struct TodaySummaryDTO:"), source.indexOf("struct TokenRecordDTO:"))}
struct Screen { let visibleFrame: NSRect }
enum NSScreen { static var screens: [Screen] = [] }
class Panel {
    var frame: NSRect
    init(_ frame: NSRect) { self.frame = frame }
    func setFrameOrigin(_ origin: NSPoint) { frame.origin = origin }
}
class HudQueries {
    let codexDirectoryPath: String
    var floatingPanel: Panel?
    init(_ path: String) { codexDirectoryPath = path }
${databaseMethods}
${screenMethod}
}
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: root) }
let queries = HudQueries(root.path)
assert(queries.queryRecentPlanChangeFromDatabase() == nil)
assert(queries.queryTodaySummaryFromDatabase().requests == 0)
assert(!FileManager.default.fileExists(atPath: root.appendingPathComponent("token_usage_history.sqlite").path))
var database: OpaquePointer?
assert(sqlite3_open(root.appendingPathComponent("token_usage_history.sqlite").path, &database) == SQLITE_OK)
defer { sqlite3_close(database) }
let now = Int64(Date().timeIntervalSince1970 * 1000)
let sql = """
CREATE TABLE token_records (timestamp INTEGER, total_tokens INTEGER, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL);
INSERT INTO token_records VALUES (0, 999, 999, 0, 999), (\\(now), 150, 100, 50, 1.25);
CREATE TABLE plan_change_events (timestamp INTEGER, datetime TEXT, previous_plan TEXT, new_plan TEXT, change_type TEXT, description TEXT);
INSERT INTO plan_change_events VALUES (\\(now), '2026-09-10T00:00:00Z', 'plus', 'pro', 'upgrade', '繁體|中文');
"""
assert(sqlite3_exec(database, sql, nil, nil, nil) == SQLITE_OK)
assert(queries.queryDatabaseRow("DELETE FROM token_records") == nil)
let summary = queries.queryTodaySummaryFromDatabase()
assert(summary.requests == 1 && summary.totalTokens == 150 && summary.inputTokens == 100 && summary.outputTokens == 50)
assert(summary.formattedCostUsd == "$1.25")
assert(queries.queryRecentPlanChangeFromDatabase()?.description == "繁體|中文")
let primary = NSRect(x: 0, y: 0, width: 1440, height: 900)
let secondary = NSRect(x: -1920, y: 0, width: 1920, height: 1080)
NSScreen.screens = [Screen(visibleFrame: primary), Screen(visibleFrame: secondary)]
let original = NSRect(x: -1000, y: 500, width: 100, height: 100)
queries.floatingPanel = Panel(original)
queries.screenParametersChanged()
assert(queries.floatingPanel!.frame == original)
NSScreen.screens = [Screen(visibleFrame: primary)]
queries.screenParametersChanged()
assert(primary.contains(queries.floatingPanel!.frame))
queries.floatingPanel!.frame.origin = NSPoint(x: 1430, y: 890)
queries.screenParametersChanged()
assert(primary.contains(queries.floatingPanel!.frame))
NSScreen.screens = []
queries.screenParametersChanged()
print("PASS")
`, encoding: "utf8", timeout: 30_000,
  });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("PASS");
}, 35_000);
