import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const menubar = readFileSync(new URL("../src/menubar/main.swift", import.meta.url), "utf8");
const hud = readFileSync(new URL("../src/floating-hud/main.swift", import.meta.url), "utf8");

test.skipIf(process.platform !== "darwin")("native HTTP timeout cancels stalled requests; CLI drains large output and restores PATH", () => {
  const httpHelper = menubar.slice(menubar.indexOf("private final class DashboardResponse"), menubar.indexOf("func fetchCLIStatus"));
  const hudHelper = hud.slice(hud.indexOf("private final class DashboardResponse"), hud.indexOf("func dashboardMatchesProfile"));
  expect(httpHelper.trim()).toBe(hudHelper.trim());
  const cliHelper = menubar.slice(menubar.indexOf("func fetchCLIStatus"), menubar.indexOf("func dashboardMatchesProfile"));
  const result = spawnSync("swift", ["-"], { input: `import Foundation
import Darwin
${httpHelper}
${cliHelper}
final class StalledProtocol: URLProtocol {
    static let cancelled = DispatchSemaphore(value: 0)
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() {}
    override func stopLoading() { Self.cancelled.signal() }
}
let config = URLSessionConfiguration.ephemeral
config.protocolClasses = [StalledProtocol.self]
let session = URLSession(configuration: config)
let started = Date()
assert(loadDashboardData(url: URL(string: "http://fixture.invalid/")!, timeout: 0.1, session: session) == nil)
assert(Date().timeIntervalSince(started) < 1.5)
assert(StalledProtocol.cancelled.wait(timeout: .now() + 1) == .success)
session.invalidateAndCancel()
let root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
defer { try? FileManager.default.removeItem(at: root) }
let cli = root.appendingPathComponent("codex-usage")
let script = """
#!/bin/sh
[ "$1" = "status" ] && [ "$2" = "--json" ] || exit 2
case "$PATH" in *"/.bun/bin"*"/opt/homebrew/bin"*) ;; *) exit 3 ;; esac
[ -d "$CODEX_HOME" ] || exit 4
exec /bin/dd if=/dev/zero bs=1024 count=1024
"""
try script.write(to: cli, atomically: true, encoding: .utf8)
try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: cli.path)
setenv("PATH", "/usr/bin:/bin", 1)
let data = try fetchCLIStatus(cliPath: cli.path, codexDirectory: root.path)
assert(data?.count == 1024 * 1024)
try "#!/bin/sh\\nexec /bin/sleep 5\\n".write(to: cli, atomically: false, encoding: .utf8)
let startCLI = Date()
let timedOut = try fetchCLIStatus(cliPath: cli.path, codexDirectory: root.path, timeoutSeconds: 0.1)
assert(timedOut == nil)
assert(Date().timeIntervalSince(startCLI) < 2)
do {
    _ = try fetchCLIStatus(cliPath: root.appendingPathComponent("missing").path, codexDirectory: root.path)
    fatalError("spawn must fail")
} catch {}
print("PASS")
`, encoding: "utf8", timeout: 30_000 });
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout).toContain("PASS");
}, 35_000);
