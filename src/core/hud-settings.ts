import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export function isValidHudInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 300;
}

export function readHudSettings(directory: string): { refreshIntervalSeconds: number } {
  try {
    const settings = JSON.parse(readFileSync(join(directory, "hud-settings.json"), "utf8"));
    if (isValidHudInterval(settings?.refreshIntervalSeconds)) return { refreshIntervalSeconds: settings.refreshIntervalSeconds };
  } catch {}
  return { refreshIntervalSeconds: 5 };
}

export function saveHudSettings(directory: string, refreshIntervalSeconds: number): void {
  if (!isValidHudInterval(refreshIntervalSeconds)) throw new Error("Interval must be an integer from 1 to 300");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporaryPath = join(directory, "hud-settings.json.tmp");
  writeFileSync(temporaryPath, JSON.stringify({ refreshIntervalSeconds }), { mode: 0o600 });
  renameSync(temporaryPath, join(directory, "hud-settings.json"));
}
