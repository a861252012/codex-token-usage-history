import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = join(import.meta.dir, "..");
const menubarPath = join(repositoryRoot, "src/menubar/main.swift");
const hudPath = join(repositoryRoot, "src/floating-hud/main.swift");
const menubarSource = readFileSync(menubarPath, "utf8");
const hudSource = readFileSync(hudPath, "utf8");

describe("native quota UI trust", () => {
  test("missing quota windows are not presented as 100%, unlimited, or online", () => {
    for (const source of [menubarSource, hudSource]) {
      expect(source).not.toContain("?? 100");
      expect(source).not.toContain("Codex 線上");
      expect(source).not.toContain("無限額度");
      expect(source).not.toContain("Unlimited (Pro Tier)");
    }

    expect(menubarSource).toContain("五小時額度: 無資料");
    expect(menubarSource).toContain("週用量額度: 無資料");
    expect(hudSource).toContain('case "quota_unavailable": return "無資料"');
    expect(hudSource).toContain('primaryValueLabel.stringValue = "--"');
    expect(hudSource).not.toContain('primaryValueLabel.stringValue = "--%"');
  });

  test("five-hour quota is rendered whenever the payload contains it", () => {
    expect(menubarSource).toContain("if let fiveHourWindow = quotaSnapshot.fiveHour {");
    expect(hudSource).toContain("if let fiveHour = snapshot.fiveHour {");
    expect(menubarSource).not.toContain("fiveHourWindow = quotaSnapshot.fiveHour, !isPro");
    expect(hudSource).not.toContain("fiveHour = snapshot.fiveHour, !proActive");
  });

  test("source, age, and failure metadata stay visible and direct file fallback is marked cache", () => {
    for (const source of [menubarSource, hudSource]) {
      expect(source).toContain("let updatedAt: Int64?");
      expect(source).toContain("let source: String?");
      expect(source).toContain("let errorReason: String?");
      expect(source).toContain("120_000");
      expect(source).toContain("timestampMilliseconds > 0");
      expect(source).toContain("timestampMilliseconds <= Int64(Date().timeIntervalSince1970 * 1000)");
      expect(source).toContain('(snapshot.errorReason ?? "").isEmpty');
      expect(source).toContain('source: "cache"');
      expect(source).toContain("errorReason");
    }

    expect(menubarSource).toContain("本機快取（非即時）");
    expect(menubarSource).toContain("資料更新:");
    expect(menubarSource).toContain("狀態說明:");
    expect(hudSource).toContain('secondaryTagLabel.stringValue = "CACHE"');
    expect(hudSource).toContain('secondaryTagLabel.stringValue = "STALE"');
    expect(hudSource).toContain("snapshot: self.asLocalCache(previousStatus.snapshot)");
    expect(hudSource).toContain('HudLocalization.string(key: "updated_at"');
    expect(hudSource).toContain('HudLocalization.string(key: "error_reason"');
  });

  test("usage count copy describes stored records, not calls or requests", () => {
    expect(menubarSource).toContain("本日紀錄筆數:");
    expect(hudSource).toContain('case "requests": return "紀錄筆數"');
    expect(hudSource).toContain('case "requests": return "Records"');
    expect(hudSource).toContain('case "calls": return "筆"');
    expect(hudSource).toContain('case "calls": return "records"');
  });

  test("reset credits are shown only when the API says the value is known", () => {
    for (const source of [menubarSource, hudSource]) {
      expect(source).toContain("let resetCreditsKnown: Bool?");
      expect(source).toContain("resetCreditsKnown: snapshot.resetCreditsKnown");
      expect(source).toContain("resetCreditsKnown == true");
    }
  });

  test("both native entry points typecheck", () => {
    for (const path of [menubarPath, hudPath]) {
      const result = spawnSync("swiftc", ["-typecheck", "-framework", "Cocoa", path], {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
    }
  });
});
