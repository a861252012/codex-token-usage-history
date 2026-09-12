import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test.skipIf(process.platform !== "darwin")("HUD lock rejects another process and recovers after exit", () => {
  const source = readFileSync(new URL("../src/floating-hud/main.swift", import.meta.url), "utf8");
  const implementation = source.slice(source.indexOf("func acquireHudLock"), source.indexOf("func makeDashboardProcess"));
  const result = spawnSync("swift", ["-"], {
    input: `import Foundation
import Darwin
${implementation}
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: root) }
let path = root.appendingPathComponent("hud.lock").path
let first = try acquireHudLock(at: path)!
let childSource = root.appendingPathComponent("child.swift")
let childCode = """
import Foundation
import Darwin
${implementation}
exit(try acquireHudLock(at: CommandLine.arguments[1]) == nil ? 0 : 1)
"""
try childCode.write(to: childSource, atomically: true, encoding: .utf8)
let child = Process()
child.executableURL = URL(fileURLWithPath: "/usr/bin/swift")
child.arguments = [childSource.path, path]
try child.run()
child.waitUntilExit()
assert(child.terminationStatus == 0)
close(first)
let second = try acquireHudLock(at: path)!
close(second)
do {
    _ = try acquireHudLock(at: root.appendingPathComponent("missing/hud.lock").path)
    fatalError("Invalid path must fail")
} catch {}
print("PASS")
`, encoding: "utf8", timeout: 60_000,
  });
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  expect(result.stdout).toContain("PASS");
}, 60_000);
