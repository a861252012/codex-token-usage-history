import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test.skipIf(process.platform !== "darwin")("HUD login preference uses an isolated LaunchAgent and round-trips", () => {
  const source = readFileSync(new URL("../src/floating-hud/main.swift", import.meta.url), "utf8");
  const loginItem = source.slice(source.indexOf("struct HudLoginItem {"), source.indexOf("// MARK: - Color"));
  const result = spawnSync("swift", ["-"], {
    input: `import Foundation
${loginItem}
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
defer { try? FileManager.default.removeItem(at: root) }
let item = HudLoginItem(homeDirectory: root, executableURL: URL(fileURLWithPath: "/bin/echo"))
assert(!item.isEnabled)
try item.setEnabled(true)
assert(item.isEnabled)
try item.setEnabled(true)
assert(item.isEnabled)
let path = root.appendingPathComponent("Library/LaunchAgents/com.codex.token-usage-hud.plist")
let plist = try PropertyListSerialization.propertyList(from: Data(contentsOf: path), format: nil) as! [String: Any]
assert(plist["KeepAlive"] == nil)
assert(plist["LimitLoadToSessionType"] as? String == "Aqua")
try item.setEnabled(false)
assert(!item.isEnabled)
assert(!FileManager.default.fileExists(atPath: path.path))
try item.setEnabled(false)
let missing = HudLoginItem(homeDirectory: root, executableURL: root.appendingPathComponent("missing"))
do {
    try missing.setEnabled(true)
    fatalError("Missing executable must fail")
} catch {}
assert(!missing.isEnabled)
print("PASS")
`,
    encoding: "utf8",
    timeout: 60_000,
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("PASS");
}, 60_000);
