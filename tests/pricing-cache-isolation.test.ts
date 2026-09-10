import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadCachedUpstreamPricing } from "../src/core/pricing-sync.js";

test("upstream pricing cache never crosses data directories inside its memo TTL", () => {
  const directory = mkdtempSync(join(tmpdir(), "codex-pricing-isolation-"));
  const previousHome = process.env.CODEX_HOME;
  const time = new Date();
  try {
    for (const name of ["first", "second"]) {
      const home = join(directory, name);
      mkdirSync(home);
      const cache = join(home, "pricing_cache.json");
      writeFileSync(cache, JSON.stringify({ updatedAtMs: time.getTime(), updatedDate: name, models: [] }), { mode: 0o644 });
      utimesSync(cache, time, time);
      process.env.CODEX_HOME = home;
      expect(loadCachedUpstreamPricing()?.updatedDate).toBe(name);
      expect(statSync(cache).mode & 0o777).toBe(0o600);
    }
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = previousHome;
    rmSync(directory, { recursive: true, force: true });
  }
});
