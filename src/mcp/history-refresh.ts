import { spawn, type ChildProcess } from "node:child_process";

/** Keep synchronous parsing/SQLite work off the stdio event loop. */
export class McpHistoryRefresh {
  private pending: Promise<void> | null = null;
  private child: ChildProcess | null = null;
  private hasFullScan = false;
  private lastAttempt = 0;
  private lastError: Error | null = null;

  private start(): Promise<void> {
    const fullScan = !this.hasFullScan;
    this.lastError = null;
    const work = new Promise<void>((resolve, reject) => {
      const child = spawn(process.execPath, [
        ...process.execArgv, process.argv[1], "index",
        ...(fullScan ? ["--all"] : ["--days", "1"]), "--json",
      ], {
        stdio: ["ignore", "pipe", "pipe"], timeout: 300_000, killSignal: "SIGKILL",
        // Preserve MCP's local-only history lookup; don't start pricing network sync.
        env: { ...process.env, CODEX_USAGE_MCP_INDEX: "1" },
      });
      this.child = child;
      let output = "";
      let stderr = "";
      child.stdout!.on("data", (chunk) => {
        output += chunk;
        if (Buffer.byteLength(output) > 1024 * 1024) {
          child.kill("SIGKILL");
          reject(new Error("History index output exceeded limit"));
        }
      });
      child.stderr!.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4096); });
      child.once("error", reject);
      child.once("close", (code, signal) => {
        try {
          if (code !== 0) {
            const diagnostic = output ? JSON.parse(output).diagnostics : null;
            throw new Error(diagnostic?.fileErrors?.[0]?.message || stderr.trim()
              || `History index failed (exit ${code}, signal ${signal})`);
          }
          const result = JSON.parse(output);
          if (!result.diagnostics || result.diagnostics.filesFailed > 0) throw new Error("History index was incomplete");
          this.hasFullScan = true;
          resolve();
        } catch (error) { reject(error); }
      });
    });
    this.pending = work.catch((error) => {
      this.lastError = error instanceof Error ? error : new Error(String(error));
      throw this.lastError;
    }).finally(() => {
      this.lastAttempt = Date.now();
      this.pending = null;
      this.child = null;
    });
    // A caller can time out before the child fails; retain the error for the next call.
    void this.pending.catch(() => {});
    return this.pending;
  }

  async refresh(waitMilliseconds = 1000): Promise<boolean> {
    if (!this.pending && Date.now() - this.lastAttempt < 30_000) {
      if (this.lastError) throw this.lastError;
      return true;
    }
    const work = this.pending ?? this.start();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work.then(() => true),
        new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), waitMilliseconds); }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  stop(): void {
    this.child?.kill("SIGKILL");
  }
}
