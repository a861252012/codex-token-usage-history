import { describe, expect, test } from "bun:test";
import { parseMcpAgentRole, parseMcpLimit } from "../src/mcp/server.js";

describe("MCP request validation", () => {
  test("bounds result limits and rejects invalid numeric values", () => {
    expect(parseMcpLimit(25, 10)).toBe(25);
    expect(parseMcpLimit(50_000, 10)).toBe(1_000);
    expect(parseMcpLimit(-1, 10)).toBe(10);
    expect(parseMcpLimit(1.5, 10)).toBe(10);
    expect(parseMcpLimit(Number.POSITIVE_INFINITY, 10)).toBe(10);
    expect(parseMcpLimit("100", 10)).toBe(10);
  });

  test("accepts unknown as an explicit role without broadening invalid filters", () => {
    expect(parseMcpAgentRole("main")).toBe("main");
    expect(parseMcpAgentRole("subagent")).toBe("subagent");
    expect(parseMcpAgentRole("unknown")).toBe("unknown");
    expect(parseMcpAgentRole("all")).toBeUndefined();
    expect(parseMcpAgentRole(1)).toBeUndefined();
  });
});
