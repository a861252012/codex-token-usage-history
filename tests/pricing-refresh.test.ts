import { test, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

for (const filename of ["pricing.json", "pricing_cache.json"]) {
  test(`定價來源 ${filename} 更新、損毀與刪除後會重新計價`, () => {
    const directory = mkdtempSync(join(tmpdir(), "pricing-refresh-"));
    try {
      const result = spawnSync(process.execPath, ["--eval", `
        import { writeFileSync, unlinkSync, utimesSync } from "node:fs";
        import { calculateTokenCost, getActivePricingConfig } from "./src/core/pricing-calculator.ts";
        import { strict as assert } from "node:assert";
        let now = Date.now();
        Date.now = () => now;
        const path = process.env.CODEX_HOME + "/${filename}";
        const cost = () => calculateTokenCost("refresh-test", 1000000, 0, 0, 0).totalCost;
        for (const price of [1, 9]) {
          now += 3000;
          writeFileSync(path, JSON.stringify({
            updatedAtMs: now, updatedDate: String(price), pricingVersion: String(price),
            models: [{modelPrefix: "refresh-test", inputCostPerMillion: price,
              cachedInputCostPerMillion: 0, outputCostPerMillion: 0, reasoningOutputCostPerMillion: 0}]
          }));
          utimesSync(path, now / 1000, now / 1000);
          getActivePricingConfig();
          assert.equal(cost(), price);
        }
        now += 3000;
        writeFileSync(path, "{invalid");
        utimesSync(path, now / 1000, now / 1000);
        assert.equal(cost(), 2);
        assert.equal(cost(), 2);
        now += 3000;
        writeFileSync(path, JSON.stringify({updatedAtMs: now, models: [
          {modelPrefix: "refresh-test", inputCostPerMillion: 7, cachedInputCostPerMillion: 0, outputCostPerMillion: 0, reasoningOutputCostPerMillion: 0}
        ]}));
        utimesSync(path, now / 1000, now / 1000);
        assert.equal(cost(), 7);
        unlinkSync(path);
        now += 3000;
        assert.equal(cost(), 2);
      `], {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, CODEX_HOME: directory },
        encoding: "utf8",
      });
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}
