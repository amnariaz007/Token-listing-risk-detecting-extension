import { assembleMemo, generateMemoId } from "../memo/assemble.ts";
import { buildBundle } from "../memo/appendix.ts";
import type { Check, EvidenceBundle, RawEvidence, SkippedCheck } from "../memo/schema.ts";
import { signMemo } from "../memo/sign.ts";
import { NETWORK, type TokenChain } from "../../config/protocol.ts";
import type { LocalAccount } from "viem";
import { SettlementLedger, type SettlementReader } from "../blockchain/verifier.ts";
import type { TokenIdentity } from "../blockchain/wallet.ts";
import { buyIntelligence, type ClientOptions, type Purchase } from "../telegraph/client.ts";
import type { CapabilitySnapshot } from "../telegraph/discovery.ts";
import { Budget, type Challenge } from "../telegraph/payments.ts";
import type { SignalCheck } from "../telegraph/signal.ts";
import { evaluatePurchase, type Executed } from "./executor.ts";
import { resolveToken, type TokenTarget } from "./input.ts";
import { CANDIDATE_INTENTS, buildPlan, type Plan, type PlannedCheck } from "./planner.ts";

export const STEPS = [
  "validate", "discover", "plan", "prepare", "challenge", "pay", "receive", "evidence", "risk", "sign",
] as const;
export type Step = (typeof STEPS)[number];

export type AgentEvent = {
  at: string;
  step: Step;
  status: "running" | "done" | "failed" | "info";
  message: string;
  check?: { name: string; intent: string; miner_id?: string | null; state?: string; quoted?: string | null; cost?: string | null; duration_ms?: number | null };
};

export type AgentDeps = {
  readIdentity: (address: string, chain: TokenChain) => Promise<TokenIdentity | null>;
  /** Finds the token's largest DEX pool. A free lookup: the liquidity figure itself is still bought. */
  findPool: (token: TokenTarget) => Promise<string | null>;
  discover: (intents: string[]) => Promise<CapabilitySnapshot>;
  probe: (body: unknown, minerId?: string | null) => Promise<{ challenge: Challenge | null; status: number; error: string | null }>;
  payFetch: ClientOptions["payFetch"];
  baseFetch?: typeof fetch;
  readSettlement: SettlementReader;
  checkSignal: (hash: string) => Promise<SignalCheck>;
  payer: string;
  signer: Pick<LocalAccount, "address" | "signMessage">;
  limits: { budgetAtomic: bigint; maxRequestAtomic: bigint; maxChecks: number; maxRequests: number; concurrency: number; timeoutMs: number };
  now?: () => Date;
  memoIdTaken?: (id: string) => boolean;
  emit?: (event: AgentEvent) => void;
};

export type AssessmentResult = {
  input: { token_input: string; chain: string; budget_atomic: string };
  token: TokenTarget;
  capabilities: CapabilitySnapshot | null;
  plan: Omit<Plan, "checks"> & { checks: Omit<PlannedCheck, "interpret">[] };
  bundle: EvidenceBundle;
  started_at: string;
  finished_at: string;
  duration_ms: number;
};

/** Runs tasks with a concurrency limit, keeping results in task order. */
async function pool<T, R>(items: T[], size: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await task(items[index] as T);
      }
    }),
  );
  return results;
}

const atomicToUsdc = (atomic: string) => `${Number(atomic) / 1e6} USDC`;

/** The full autonomous run. Input errors throw before anything is spent. Every later failure stays visible in the memo. */
export async function runAssessment(tokenInput: unknown, deps: AgentDeps, chain: TokenChain = "ethereum"): Promise<AssessmentResult> {
  const clock = deps.now ?? (() => new Date());
  const startedAt = clock();
  const emit = (step: Step, status: AgentEvent["status"], message: string, check?: AgentEvent["check"]) => deps.emit?.({ at: clock().toISOString(), step, status, message, check });

  emit("validate", "running", "Validating token input");
  const token = await resolveToken(tokenInput, chain, deps.readIdentity);
  emit("validate", "done", token.address ? `Read ${token.symbol} from its contract ${token.address} on ${token.chain}` : `Accepted symbol ${token.symbol}. It is not resolved to a single contract.`);

  emit("discover", "running", "Discovering live intelligence capabilities");
  let capabilities: CapabilitySnapshot | null = null;
  let discoveryError = "";
  try {
    capabilities = await deps.discover(CANDIDATE_INTENTS);
    emit("discover", "done", `${capabilities.intent_count} live intents on ${capabilities.node}`);
  } catch (err) {
    discoveryError = (err as Error).message;
    emit("discover", "failed", `Telegraph node unavailable: ${discoveryError}`);
  }

  emit("plan", "running", "Planning intelligence purchases");
  const budget = new Budget(deps.limits.budgetAtomic, deps.limits.maxRequestAtomic, deps.limits.maxRequests);
  let poolAddress: string | null = null;
  if (token.address) {
    try {
      poolAddress = await deps.findPool(token);
    } catch (err) {
      emit("plan", "info", `DEX pool lookup failed: ${(err as Error).message}`);
    }
    emit("plan", "info", poolAddress ? `Largest DEX pool: ${poolAddress}` : "No DEX pool found for this token.");
  }
  const plan: Plan = capabilities
    ? await buildPlan(token, capabilities, { pool: poolAddress }, { budgetAtomic: deps.limits.budgetAtomic, maxRequestAtomic: deps.limits.maxRequestAtomic, maxChecks: deps.limits.maxChecks }, deps.probe)
    : { checks: [], skipped: [], not_selected: [], expected_atomic: "0", budget_atomic: deps.limits.budgetAtomic.toString() };
  for (const c of plan.checks) emit("plan", "info", `${c.name}: ${c.why} ${c.miner ? `Asking ${c.miner.slug}.` : "The network will route this."}`, { name: c.name, intent: c.intent, miner_id: c.miner?.id, state: "planned", quoted: atomicToUsdc(c.quoted_atomic) });
  for (const s of plan.skipped) emit("plan", "info", `Skipping ${s.name}: ${s.reason}`, { name: s.name, intent: s.intent ?? "", state: "skipped" });
  emit("plan", "done", `${plan.checks.length} checks planned. Expected ${atomicToUsdc(plan.expected_atomic)}, authorized up to ${atomicToUsdc(plan.budget_atomic)}.`);

  const ledger = new SettlementLedger(deps.readSettlement);
  const skippedByAgent: SkippedCheck[] = [...plan.skipped];
  if (!capabilities) {
    for (const name of CANDIDATE_INTENTS) skippedByAgent.push({ name, intent: name, reason: `Telegraph node unavailable: ${discoveryError}` });
  }

  const purchaseOne = async (check: PlannedCheck, source: { name: string; minerId: string | null } = { name: check.name, minerId: check.miner?.id ?? null }): Promise<Executed> => {
    const label = { name: source.name, intent: check.intent };
    emit("prepare", "info", `Prepared ${check.intent} request`, { ...label, state: "prepared" });
    const purchase: Purchase = await buyIntelligence(check.intent, {}, {
      body: check.body,
      payFetch: deps.payFetch,
      baseFetch: deps.baseFetch,
      budget,
      minerId: source.minerId,
      timeoutMs: deps.limits.timeoutMs,
      onEvent: (e) => {
        if (e.type === "challenge") emit("challenge", "info", `HTTP 402: ${atomicToUsdc(e.challenge.amountAtomic)} requested for ${check.intent}`, { ...label, state: "payment required", quoted: atomicToUsdc(e.challenge.amountAtomic) });
        else emit("pay", "info", `Sent x402 payment for ${check.intent}`, { ...label, state: "paying" });
      },
    });
    emit("receive", purchase.error ? "failed" : "info", purchase.error ? `${source.name} failed: ${purchase.error}` : `Miner response received for ${check.intent}`, { ...label, state: purchase.error ? "failed" : "received", duration_ms: purchase.durationMs });
    const executed = await evaluatePurchase({ name: source.name, intent: check.intent, interpret: check.interpret, tier: check.tier }, purchase, token, { payer: deps.payer, ledger, checkSignal: deps.checkSignal });
    const c = executed.check;
    emit("evidence", c.status === "ok" ? "info" : "failed", c.status === "ok" ? `Verified payment for ${c.name}: ${c.payment?.amount} ${c.payment?.currency}, receipt ${c.receipt_reference}` : `${c.name} ${c.status}: ${c.failure_reason}`, {
      ...label,
      miner_id: c.miner_id,
      state: c.status,
      cost: c.payment?.status === "confirmed" ? `${c.payment.amount} ${c.payment.currency}` : null,
      duration_ms: purchase.durationMs,
    });
    return executed;
  };

  const executed: Executed[] = [];
  let remaining = plan.checks;
  // A bare symbol cannot be verified for free, so its price check runs first and stops the spend on an unknown token.
  const priceCheck = token.address ? undefined : remaining.find((c) => c.intent === "CRYPTO_PRICE_USD");
  if (priceCheck) {
    const result = await purchaseOne(priceCheck);
    executed.push(result);
    remaining = remaining.filter((c) => c !== priceCheck);
    if (result.check.signals.some((s) => s.level === "inconclusive")) {
      emit("plan", "info", `No market price for ${token.symbol}, so the remaining purchases were cancelled to avoid paying for intelligence on an unverified symbol.`);
      for (const c of remaining) skippedByAgent.push({ name: c.name, intent: c.intent, reason: `Cancelled before payment: ${token.symbol} returned no market price.` });
      remaining = [];
    }
  }
  executed.push(...(await pool(remaining, deps.limits.concurrency, (c) => purchaseOne(c))));

  // A miner that gave no usable answer gets one replacement, in priority order, while budget and requests remain.
  for (const check of plan.checks) {
    const first = executed.find((e) => e.check.name === check.name);
    const unusable = first?.check.status === "ok" && first.check.signals.some((s) => s.code === "unusable_answer");
    const alternate = check.alternates[0];
    if (!first || !unusable || !alternate) continue;
    const quote = await deps.probe(check.body, alternate.id);
    const amount = quote.challenge ? BigInt(quote.challenge.amountAtomic) : null;
    const spent = budget.reservedAtomic;
    if (amount === null || spent + amount > deps.limits.budgetAtomic || budget.requestCount >= deps.limits.maxRequests) {
      emit("plan", "info", `${check.name} gave no usable answer, and there is no budget left for a second source.`);
      continue;
    }
    emit("plan", "info", `${check.name} gave no usable answer, so the agent is asking ${alternate.slug} as a second source.`);
    const second = await purchaseOne(check, { name: `${check.name} (second source)`, minerId: alternate.id });
    executed.push(second);
    if (second.check.status === "ok" && !second.check.signals.some((s) => s.level === "inconclusive")) {
      first.check = {
        ...first.check,
        finding: "No usable answer",
        tier: 4,
        signals: [{ level: "superseded", code: "replaced_by_second_source", topic: first.check.signals[0]?.topic ?? "unknown", basis: "inference", explanation: "This source gave no usable answer and was replaced" }],
      };
    }
  }
  emit("receive", "done", `${executed.length} requests completed`);
  emit("evidence", "done", `${executed.filter((e) => e.check.status === "ok").length} purchases verified`);

  emit("risk", "running", "Evaluating risk with deterministic rules");
  const order = new Map(plan.checks.flatMap((c, i) => [[c.name, i * 2], [`${c.name} (second source)`, i * 2 + 1]] as [string, number][]));
  const sorted = [...executed].sort((a, b) => (order.get(a.check.name) ?? 0) - (order.get(b.check.name) ?? 0));
  const checks: Check[] = sorted.map((e) => e.check);
  const raw: RawEvidence[] = sorted.map((e) => e.raw);

  const limitations: string[] = [];
  if (!token.address) limitations.push(`${token.symbol} was given as a symbol. Symbols can be shared by several tokens, so this memo is not tied to one contract.`);
  if (checks.some((c) => c.status === "ok" && c.signal_hash === null)) limitations.push("At least one response carried no signal hash.");
  if (plan.not_selected.length > 0) limitations.push(`Not requested: ${plan.not_selected.map((n) => n.name).join(", ")} (check limit).`);
  if (checks.some((c) => c.name === "Liquidity" && c.status === "ok")) limitations.push("Liquidity is the largest pool's reserve, found with a free DexScreener lookup. Slippage was not measured.");

  let memoId = generateMemoId(startedAt);
  while (deps.memoIdTaken?.(memoId)) memoId = generateMemoId(startedAt);
  const memo = assembleMemo({
    memoId,
    token: { name: token.name, symbol: token.symbol, address: token.address, chain: token.chain, identity_source: token.identity_source },
    now: startedAt,
    signedAt: clock(),
    network: NETWORK.kind,
    paymentNetwork: NETWORK.name,
    checks,
    checksSkipped: skippedByAgent,
    limitations,
  });
  emit("risk", "done", `${memo.verdict}, confidence ${memo.confidence}: ${memo.verdict_reason}`);

  emit("sign", "running", "Signing the finished memo");
  const signed = await signMemo(memo, deps.signer);
  emit("sign", "done", `Signed by ${signed.signer_address}. Memo hash ${signed.memo_hash}`);

  const finished = clock();
  const { checks: planChecks, ...planRest } = plan;
  return {
    input: { token_input: String(tokenInput), chain, budget_atomic: deps.limits.budgetAtomic.toString() },
    token,
    capabilities,
    plan: { ...planRest, checks: planChecks.map(({ interpret: _interpret, ...c }) => c) },
    bundle: buildBundle(signed, raw),
    started_at: startedAt.toISOString(),
    finished_at: finished.toISOString(),
    duration_ms: finished.getTime() - startedAt.getTime(),
  };
}
