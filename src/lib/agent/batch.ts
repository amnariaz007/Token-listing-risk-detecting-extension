import { randomBytes } from "node:crypto";
import { TOKEN_CHAINS, limits, type TokenChain } from "../../config/protocol.ts";
import type { Memo } from "../memo/schema.ts";
import { createStore, type Store } from "../storage/assessments.ts";
import { InputError } from "./input.ts";
import { runAssessment, type AgentEvent, type AssessmentResult } from "./orchestrator.ts";
import { liveDeps } from "./runtime.ts";

export const MAX_BATCH_TOKENS = 10;

export type BatchItem = { token: string; chain: TokenChain };
export type BatchRow = BatchItem & {
  symbol?: string;
  status: "queued" | "running" | "done" | "error" | "not_run";
  memo_id: string | null;
  verdict: Memo["verdict"] | null;
  confidence: Memo["confidence"] | null;
  top_reason: string | null;
  cost: string | null;
  cost_atomic: string;
};
export type Batch = { id: string; created_at: string; done: boolean; budget_atomic: string; rows: BatchRow[] };

const VERDICT_RANK: Record<string, number> = { "HIGH RISK": 0, CAUTION: 1, CLEAR: 2 };
const STATUS_RANK: Record<BatchRow["status"], number> = { done: 0, running: 1, queued: 2, error: 3, not_run: 4 };

/** The most serious stated reason in a memo: a hard flag, then a soft flag, then its overall reason. */
export function topReason(memo: Memo): string {
  const signals = memo.checks.filter((c) => c.status === "ok").flatMap((c) => c.signals);
  const worst = signals.find((s) => s.level === "hard") ?? signals.find((s) => s.level === "soft");
  return worst?.explanation ?? memo.verdict_reason;
}

/** Riskiest first. Within a verdict, more soft signals rank higher. Rows without a result go last. */
export function rankRows(rows: BatchRow[], softCount: (row: BatchRow) => number = () => 0): BatchRow[] {
  return [...rows].sort(
    (a, b) =>
      STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
      (VERDICT_RANK[a.verdict ?? ""] ?? 9) - (VERDICT_RANK[b.verdict ?? ""] ?? 9) ||
      softCount(b) - softCount(a),
  );
}

export function parseBatchInput(lines: unknown): BatchItem[] {
  if (!Array.isArray(lines)) throw new InputError("Provide a list of tokens.");
  const items = lines.map((raw): BatchItem => {
    const { token, chain = "ethereum" } = (raw ?? {}) as { token?: unknown; chain?: unknown };
    if (typeof token !== "string" || !token.trim()) throw new InputError("Every row needs a token.");
    if (typeof chain !== "string" || !(chain in TOKEN_CHAINS)) throw new InputError(`Unknown chain: ${String(chain)}`);
    return { token: token.trim(), chain: chain as TokenChain };
  });
  if (items.length < 2 || items.length > MAX_BATCH_TOKENS) throw new InputError(`A batch takes 2 to ${MAX_BATCH_TOKENS} tokens.`);
  return items;
}

const state = globalThis as unknown as { __lrmBatches?: Map<string, Batch> };
const batches = (state.__lrmBatches ??= new Map<string, Batch>());
export const hasActiveBatch = () => [...batches.values()].some((b) => !b.done);

type RunOne = (item: BatchItem, budgetAtomic: bigint, emit: (e: AgentEvent) => void) => Promise<AssessmentResult>;

/** Runs tokens one at a time through the normal assessment. Each has its own Budget, and the batch stops when its total is used. */
export async function runBatch(batch: Batch, store: Pick<Store, "save" | "saveBatch">, runOne: RunOne, perTokenAtomic: bigint): Promise<void> {
  let spent = 0n;
  const softByRow = new Map<BatchRow, number>();
  const persist = () => {
    batch.rows = rankRows(batch.rows, (r) => softByRow.get(r) ?? 0);
    store.saveBatch(batch);
  };
  for (const row of [...batch.rows]) {
    const remaining = BigInt(batch.budget_atomic) - spent;
    const budget = remaining < perTokenAtomic ? remaining : perTokenAtomic;
    if (budget < 10_000n) {
      row.status = "not_run";
      row.top_reason = "Not run: the batch budget was used up.";
      persist();
      continue;
    }
    row.status = "running";
    persist();
    const events: AgentEvent[] = [];
    try {
      const result = await runOne(row, budget, (e) => events.push(e));
      const memo = result.bundle.signed.memo;
      row.memo_id = store.save(result, events);
      row.symbol = memo.token.symbol;
      row.verdict = memo.verdict;
      row.confidence = memo.confidence;
      row.top_reason = topReason(memo);
      const paid = memo.cost.totals.reduce((sum, t) => sum + BigInt(t.amount_atomic), 0n);
      const settled = memo.cost.failed_attempt_spend.reduce((sum, t) => sum + BigInt(t.amount_atomic), 0n);
      row.cost_atomic = paid.toString();
      row.cost = memo.cost.totals.map((t) => `${t.amount} ${t.currency}`).join(" + ") || "0";
      spent += paid + settled;
      softByRow.set(row, memo.checks.flatMap((c) => c.signals).filter((s) => s.level === "soft").length);
      row.status = "done";
    } catch (err) {
      row.status = "error";
      row.top_reason = (err as Error).message;
    }
    persist();
  }
  batch.done = true;
  persist();
}

export function startBatch(items: BatchItem[]): Batch {
  const l = limits();
  const store = createStore();
  const batch: Batch = {
    id: `B-${randomBytes(4).toString("hex").toUpperCase()}`,
    created_at: new Date().toISOString(),
    done: false,
    budget_atomic: l.maxBatchAtomic.toString(),
    rows: items.map((item) => ({ ...item, status: "queued", memo_id: null, verdict: null, confidence: null, top_reason: null, cost: null, cost_atomic: "0" })),
  };
  batches.set(batch.id, batch);
  store.saveBatch(batch);
  const runOne: RunOne = (item, budget, emit) => runAssessment(item.token, liveDeps(budget, store, emit), item.chain);
  void runBatch(batch, store, runOne, l.maxAssessmentAtomic).catch(() => {
    batch.done = true;
  });
  return batch;
}

export const getBatch = (id: string): Batch | null => batches.get(id) ?? (createStore().loadBatch(id) as Batch | null);
