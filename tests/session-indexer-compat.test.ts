import { afterEach, beforeEach, expect, test } from "bun:test";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HistoryDatabase } from "../src/core/history-db.js";
import { SessionIndexer } from "../src/core/session-indexer.js";

let root: string;
let database: HistoryDatabase;
let indexer: SessionIndexer;
let file: string;
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "session-compat-"));
  database = new HistoryDatabase(":memory:");
  await database.init();
  indexer = new SessionIndexer(database, root);
  file = join(root, "session.jsonl");
});
afterEach(() => { database.close(); rmSync(root, { recursive: true, force: true }); });

const usage = (input: number, output = 0, cached = 0, reasoning = 0) => ({
  input_tokens: input, cached_input_tokens: cached, output_tokens: output,
  reasoning_output_tokens: reasoning, total_tokens: input + output,
});
const metadata = { type: "session_meta", payload: { id: "session", source: "cli" } };
const turn = (id: string, model = "gpt-6-astra") => ({ type: "turn_context", payload: { turn_id: id, model } });
const legacy = (second: number, total: ReturnType<typeof usage>, last = total) => ({
  type: "event_msg", timestamp: `2026-09-10T00:00:${String(second).padStart(2, "0")}Z`,
  payload: { type: "token_count", info: { total_token_usage: total, last_token_usage: last, model_context_window: 200_000 }, rate_limits: null },
});
const modern = (second: number, tokens: ReturnType<typeof usage>, turnId = "turn") => ({
  type: "token_usage_record", timestamp: `2026-09-10T00:00:${String(second).padStart(2, "0")}Z`,
  payload: { session_id: "session", thread_id: "thread", turn_id: turnId, response_id: `response-${second}`, usage: tokens },
});
const write = (events: unknown[]) => writeFileSync(file, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
const append = (events: unknown[]) => appendFileSync(file, events.map((event) => JSON.stringify(event)).join("\n") + "\n");

test("non-object JSON lines are invalid records and do not discard surrounding valid usage", () => {
  write([metadata, modern(1, usage(10)), null, 42, [], "text", modern(2, usage(20))]);
  expect(indexer.indexFile(file).insertedCount).toBe(2);
  expect(database.getSummary().totalTokens).toBe(30);
  expect(indexer.getDiagnostics().invalidRecords).toBe(4);
  expect(indexer.getDiagnostics().filesFailed).toBe(0);
});

test("missing, null and malformed timestamps never create records during append or forced reimport", () => {
  write([metadata, ...[undefined, null, {}, "invalid"].map((timestamp) => ({ ...modern(1, usage(10)), timestamp })), modern(2, usage(20))]);
  expect(indexer.indexFile(file).insertedCount).toBe(1);
  expect(indexer.getDiagnostics().invalidRecords).toBe(4);
  append([turn("later")]);
  expect(indexer.indexFile(file).insertedCount).toBe(0);
  expect(indexer.indexFile(file, true).insertedCount).toBe(0);
  expect(database.getSummary().totalTokens).toBe(20);
});

test("legacy cumulative differences count each response once, preserve token components and ignore context estimates", () => {
  const first = usage(1_000, 300, 200, 100);
  const total = usage(1_400, 500, 300, 150);
  write([metadata, turn("old"), legacy(1, first), legacy(2, first),
    legacy(3, first, { ...usage(0), total_tokens: 50_000 }), legacy(4, total, usage(400, 200, 100, 50))]);
  expect(indexer.indexFile(file).insertedCount).toBe(2);
  const summary = database.getSummary();
  expect([summary.totalTokens, summary.inputTokens, summary.cachedInputTokens, summary.outputTokens, summary.reasoningOutputTokens]).toEqual([1900, 1400, 300, 500, 150]);
  expect(summary.mainAgentTokens).toBe(1900);
  expect(indexer.indexFile(file, true).insertedCount).toBe(0);
  append([legacy(5, usage(1_500, 550, 300, 150), usage(100, 50))]);
  expect(indexer.indexFile(file).insertedCount).toBe(1);
  expect(database.getSummary().totalTokens).toBe(2050);
});

test("mixed legacy and modern segments reconcile cumulative usage through append and forced scans", () => {
  write([metadata, turn("old", "gpt-5"), legacy(1, usage(100, 30))]);
  expect(indexer.indexFile(file).insertedCount).toBe(1);
  append([turn("new"), modern(2, usage(200, 50)), legacy(3, usage(300, 80), usage(200, 50)),
    legacy(4, usage(300, 80), usage(200, 50))]);
  expect(indexer.indexFile(file).insertedCount).toBe(1);
  expect(database.getSummary().totalTokens).toBe(380);
  expect(indexer.indexFile(file, true).insertedCount).toBe(0);
  append([turn("old-again", "gpt-5"), legacy(5, usage(400, 100), usage(100, 20))]);
  expect(indexer.indexFile(file).insertedCount).toBe(1);
  expect(database.getSummary().totalTokens).toBe(500);
  expect(database.getSummary().byModel.map(({ model, totalTokens }) => [model, totalTokens])).toEqual([["gpt-5", 250], ["gpt-6-astra", 250]]);
});

test("quota-only replays between modern responses do not consume pending usage twice", () => {
  write([metadata, turn("new"), modern(1, usage(10, 2)), legacy(2, usage(10, 2)),
    modern(3, usage(20, 4)), legacy(4, usage(10, 2)), legacy(5, usage(30, 6))]);
  expect(indexer.indexFile(file).insertedCount).toBe(2);
  expect(database.getSummary().totalTokens).toBe(36);
  expect(indexer.indexFile(file, true).insertedCount).toBe(0);
});

test("multiple modern responses before one cumulative event remain counted once", () => {
  const first = modern(1, usage(10, 2));
  write([metadata, first, first, modern(2, usage(20, 4)), legacy(3, usage(30, 6)), legacy(4, usage(40, 8), usage(10, 2))]);
  expect(indexer.indexFile(file).insertedCount).toBe(3);
  expect(database.getSummary().totalTokens).toBe(48);
});

test("cumulative counter resets rebase using measured last usage and ignore total-only context fills", () => {
  write([metadata, legacy(1, usage(100, 20)), legacy(2, { ...usage(0), total_tokens: 200_000 }),
    legacy(3, { ...usage(10, 2), total_tokens: 200_012 }, usage(10, 2)),
    legacy(4, usage(5, 1), usage(5, 1))]);
  expect(indexer.indexFile(file).insertedCount).toBe(3);
  expect(database.getSummary().totalTokens).toBe(138);
});

test("invalid cumulative usage and last-only snapshots do not invent repeated requests", () => {
  const invalid = legacy(2, usage(-10));
  const lastOnly = { ...legacy(3, usage(10)), payload: { type: "token_count", info: { last_token_usage: usage(10) } } };
  write([metadata, legacy(1, usage(10)), invalid, lastOnly, legacy(4, usage(20), usage(10))]);
  expect(indexer.indexFile(file).insertedCount).toBe(2);
  expect(database.getSummary().totalTokens).toBe(20);
  expect(indexer.getDiagnostics().invalidRecords).toBe(2);
});


test("replayed earlier cumulative snapshots do not create another generation of usage", () => {
  write([metadata, legacy(1, usage(10, 2)), legacy(2, usage(30, 6), usage(20, 4)),
    legacy(3, usage(10, 2)), legacy(4, usage(30, 6), usage(20, 4)), legacy(5, usage(40, 8), usage(10, 2))]);
  expect(indexer.indexFile(file).insertedCount).toBe(3);
  expect(database.getSummary().totalTokens).toBe(48);
});

test("a modern response accompanying a reset cumulative counter remains counted once", () => {
  write([metadata, legacy(1, usage(100, 20)), modern(2, usage(5, 1)), legacy(3, usage(5, 1))]);
  expect(indexer.indexFile(file).insertedCount).toBe(2);
  expect(database.getSummary().totalTokens).toBe(126);
});

test("invalid legacy timestamp is skipped without charging its cumulative usage to the next event", () => {
  write([metadata, { ...legacy(1, usage(10, 2)), timestamp: undefined }, legacy(2, usage(30, 6), usage(20, 4))]);
  expect(indexer.indexFile(file).insertedCount).toBe(1);
  expect(indexer.getDiagnostics().invalidRecords).toBe(1);
  expect(database.getSummary().totalTokens).toBe(24);
});

for (const secondInput of [20, 10]) {
  test(`repeated context fills start a new cumulative generation before a ${secondInput}-token response`, () => {
    const fill = { ...usage(0), total_tokens: 200_000 };
    write([metadata, legacy(1, usage(100, 20)), legacy(2, fill),
      legacy(3, { ...usage(10, 2), total_tokens: 200_012 }, usage(10, 2))]);
    expect(indexer.indexFile(file).insertedCount).toBe(2);
    const secondOutput = secondInput / 5;
    append([legacy(4, fill, usage(0)), legacy(5, { ...usage(secondInput, secondOutput), total_tokens: 200_000 + secondInput + secondOutput }, usage(secondInput, secondOutput))]);
    expect(indexer.indexFile(file).insertedCount).toBe(1);
    expect(database.getSummary().totalTokens).toBe(132 + secondInput + secondOutput);
    expect(indexer.indexFile(file, true).insertedCount).toBe(0);
  });
}

test("context generation changes preserve modern reconciliation", () => {
  const fill = { ...usage(0), total_tokens: 200_000 };
  write([metadata, legacy(1, usage(100, 20)), legacy(2, fill),
    modern(3, usage(10, 2)), legacy(4, { ...usage(10, 2), total_tokens: 200_012 }, usage(10, 2)),
    legacy(5, fill, usage(0)), modern(6, usage(10, 2)),
    legacy(7, { ...usage(10, 2), total_tokens: 200_012 }, usage(10, 2))]);
  expect(indexer.indexFile(file).insertedCount).toBe(3);
  expect(database.getSummary().totalTokens).toBe(144);
});

test("referenced forks establish their baseline without charging inherited usage", () => {
  const childMetadata = { ...metadata, payload: { ...metadata.payload, history_base: { thread_id: "parent", end_ordinal_exclusive: 100, end_byte_offset: 10_000 } } };
  write([childMetadata, modern(1, usage(20)), legacy(2, usage(1020), usage(20)), legacy(3, usage(1050), usage(30))]);
  expect(indexer.indexFile(file).insertedCount).toBe(2);
  expect(database.getSummary().totalTokens).toBe(50);
  expect(indexer.indexFile(file, true).insertedCount).toBe(0);
});

test("referenced fork baseline consumes all preceding modern usage even if last is smaller", () => {
  const childMetadata = { ...metadata, payload: { ...metadata.payload, history_base: { thread_id: "parent", end_ordinal_exclusive: 100, end_byte_offset: 10_000 } } };
  write([childMetadata, modern(1, usage(20)), modern(2, usage(30)), legacy(3, usage(1050), usage(30)), legacy(4, usage(1060), usage(10))]);
  expect(indexer.indexFile(file).insertedCount).toBe(3);
  expect(database.getSummary().totalTokens).toBe(60);
});


test("referenced fork startup snapshots cannot charge the parent's last response", () => {
  const childMetadata = { ...metadata, payload: { ...metadata.payload, history_base: { thread_id: "parent", end_ordinal_exclusive: 100, end_byte_offset: 10_000 } } };
  write([childMetadata, legacy(1, usage(1000), usage(100)), legacy(2, usage(1000), usage(100)),
    modern(3, usage(20)), legacy(4, usage(1020), usage(20))]);
  expect(indexer.indexFile(file).insertedCount).toBe(1);
  expect(database.getSummary().totalTokens).toBe(20);
});
