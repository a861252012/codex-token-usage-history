import { renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

/** Readers see either the old file or the complete replacement, with private permissions. */
export function writePrivateFileAtomic(filePath: string, content: string): void {
  const temporaryPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
  try {
    writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
    renameSync(temporaryPath, filePath);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
}
