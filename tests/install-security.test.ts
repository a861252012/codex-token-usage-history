import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("LaunchAgent values are XML-escaped before plist generation", () => {
  const script = readFileSync(join(import.meta.dir, "../scripts/install.sh"), "utf8");
  const start = script.indexOf("xml_escape() {");
  const end = script.indexOf("\ncat << PLIST_EOF", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);

  const result = spawnSync("/bin/bash", ["-c", `${script.slice(start, end)}\nprintf '%s\\n%s' "$ESCAPED_BIN" "$ESCAPED_LOG"`], {
    env: {
      ...process.env,
      SCRIPT_DIRECTORY: "/tmp/project & <danger> \"quoted\" 'single'",
      HOME: "/tmp/home & <danger>",
      CODEX_HOME: "",
    },
    encoding: "utf8",
  });

  expect(result.status).toBe(0);
  expect(result.stdout.split("\n")).toEqual([
    "/tmp/project &amp; &lt;danger&gt; &quot;quoted&quot; &apos;single&apos;/bin/codex-usage",
    "/tmp/home &amp; &lt;danger&gt;/.codex/token-usage-server.log",
  ]);
});

test("the printed zsh prompt integration rereads quota on every prompt", () => {
  const script = readFileSync(join(import.meta.dir, "../scripts/setup-codex-hook.sh"), "utf8");
  const marker = "cat <<'SHELL_INTEGRATION'\n";
  const start = script.indexOf(marker);
  const end = script.indexOf("\nSHELL_INTEGRATION", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const snippet = script.slice(start + marker.length, end);
  const result = spawnSync("zsh", ["-f", "-c", `
    codex-usage() { print -r -- "$quota_fixture"; }
    RPROMPT='existing prompt'
    ${snippet}
    quota_fixture=first
    print -P -- "$RPROMPT"
    quota_fixture=updated
    print -P -- "$RPROMPT"
  `], { encoding: "utf8" });
  expect(result.status).toBe(0);
  expect(result.stdout.trim().split("\n")).toEqual(["first existing prompt", "updated existing prompt"]);
});
