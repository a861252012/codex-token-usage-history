import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("MCP setup supports renamed paths and a custom Codex home", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-path-test-"));
  try {
    const project = join(directory, 'different project "名稱"');
    const home = join(directory, "user home");
    const codexHome = join(directory, "custom data");
    mkdirSync(join(project, "scripts"), { recursive: true });
    mkdirSync(home);
    mkdirSync(codexHome);
    writeFileSync(join(codexHome, "config.toml"), "");
    const script = join(project, "scripts/setup-codex-hook.sh");
    copyFileSync(join(import.meta.dir, "../scripts/setup-codex-hook.sh"), script);
    const result = spawnSync("bash", [script], { env: { ...process.env, HOME: home, CODEX_HOME: codexHome }, encoding: "utf8" });
    expect(result.status).toBe(0);
    const config = Bun.TOML.parse(readFileSync(join(codexHome, "config.toml"), "utf8")) as any;
    expect(config.mcp_servers.codex_token_usage.command).toBe(join(project, "bin/codex-usage"));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
