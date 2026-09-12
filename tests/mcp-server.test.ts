import { describe, expect, test } from "bun:test";
import { parseMcpAgentRole, parseMcpLimit } from "../src/mcp/server.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

describe("MCP request validation", () => {
  test("bounds result limits and rejects invalid numeric values", () => {
    expect(parseMcpLimit(25, 10)).toBe(25);
    expect(parseMcpLimit(50_000, 10)).toBe(1_000);
    expect(parseMcpLimit(-1, 10)).toBe(10);
    expect(parseMcpLimit(1.5, 10)).toBe(10);
    expect(parseMcpLimit(Number.POSITIVE_INFINITY, 10)).toBe(10);
    expect(parseMcpLimit("100", 10)).toBe(10);
  });

  test("stdio survives invalid input, acknowledges ping, and does not reply to notifications", () => {
    const directory = mkdtempSync(join(tmpdir(), "codex-mcp-protocol-"));
    const requests = [
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      "{", "null", "[]", JSON.stringify({ jsonrpc: "1.0", id: 2, method: "ping" }),
      JSON.stringify({ jsonrpc: "2.0", id: {}, method: "ping" }),
      JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping", params: "invalid" }),
      JSON.stringify({ jsonrpc: "2.0", method: "tools/list" }),
      JSON.stringify({ jsonrpc: "2.0", id: "alive", method: "ping" }),
      JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/list" }),
    ];
    try {
      const result = spawnSync(process.execPath, ["src/cli/index.ts", "mcp"], {
        cwd: join(import.meta.dir, ".."), env: { ...process.env, CODEX_HOME: directory },
        input: requests.join("\n") + "\n", encoding: "utf8", timeout: 5000,
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toBe("");
      const responses = result.stdout.trim().split("\n").map((line) => JSON.parse(line));
      expect(responses).toHaveLength(9);
      expect(responses[0].result.protocolVersion).toBe("2024-11-05");
      expect(responses.slice(1, 6).map((response) => [response.id, response.error.code])).toEqual([
        [null, -32700], [null, -32600], [null, -32600], [null, -32600], [null, -32600],
      ]);
      expect(responses[6]).toMatchObject({ id: 3, error: { code: -32602 } });
      expect(responses[7]).toEqual({ jsonrpc: "2.0", id: "alive", result: {} });
      expect(responses[8].result.tools).toHaveLength(6);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("accepts unknown as an explicit role without broadening invalid filters", () => {
    expect(parseMcpAgentRole("main")).toBe("main");
    expect(parseMcpAgentRole("subagent")).toBe("subagent");
    expect(parseMcpAgentRole("unknown")).toBe("unknown");
    expect(parseMcpAgentRole("all")).toBeUndefined();
    expect(parseMcpAgentRole(1)).toBeUndefined();
  });
});
