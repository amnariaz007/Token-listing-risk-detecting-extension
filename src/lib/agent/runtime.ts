import { wrapFetchWithPayment } from "@x402/fetch";
import { randomUUID } from "node:crypto";
import { TOKEN_CHAINS, limits, type TokenChain } from "../../config/protocol.ts";
import { createSettlementReader } from "../blockchain/verifier.ts";
import { paymentAccount, readTokenIdentity, sepoliaClient, signerAccount } from "../blockchain/wallet.ts";
import { probePrice } from "../telegraph/client.ts";
import { discoverCapabilities } from "../telegraph/discovery.ts";
import { createPaymentClient } from "../telegraph/payments.ts";
import { checkSignal } from "../telegraph/signal.ts";
import { InputError, type TokenTarget } from "./input.ts";
import { runAssessment, type AgentDeps, type AgentEvent } from "./orchestrator.ts";
import { createStore, type Store } from "../storage/assessments.ts";

/** The token's largest pool on its own chain, from DexScreener's free public API. */
export async function findLargestPool(token: TokenTarget, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (!token.address || !(token.chain in TOKEN_CHAINS) || TOKEN_CHAINS[token.chain as TokenChain].testnet) return null;
  const res = await fetchImpl(`https://api.dexscreener.com/latest/dex/tokens/${token.address}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`DexScreener returned HTTP ${res.status}`);
  const { pairs } = (await res.json()) as { pairs?: { chainId?: string; pairAddress?: string; liquidity?: { usd?: number } }[] | null };
  const top = (pairs ?? []).filter((p) => p.chainId === token.chain && p.pairAddress).sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
  return top?.pairAddress ?? null;
}

export function liveDeps(budgetAtomic: bigint, store: Store, emit: (e: AgentEvent) => void): AgentDeps {
  const account = paymentAccount();
  const client = sepoliaClient();
  const l = limits();
  const payments = createPaymentClient(account, client, l.maxRequestAtomic);
  return {
    readIdentity: (address, chain) => readTokenIdentity(address, chain),
    findPool: (token) => findLargestPool(token),
    discover: (intents) => discoverCapabilities(intents),
    probe: (body, minerId) => probePrice(body, minerId),
    payFetch: (base) => wrapFetchWithPayment(base, payments),
    readSettlement: createSettlementReader(client),
    checkSignal: (hash) => checkSignal(hash),
    payer: account.address,
    signer: signerAccount(),
    limits: { budgetAtomic, maxRequestAtomic: l.maxRequestAtomic, maxChecks: l.maxChecks, maxRequests: l.maxRequests, concurrency: l.concurrency, timeoutMs: l.requestTimeoutMs },
    memoIdTaken: store.exists,
    emit,
  };
}

export type Run = { runId: string; events: AgentEvent[]; listeners: Set<(e: AgentEvent | null) => void>; done: boolean; memoId: string | null; error: string | null };

// Survives Next.js module reloads in development.
const state = globalThis as unknown as { __lrmRuns?: Map<string, Run> };
const runs = (state.__lrmRuns ??= new Map<string, Run>());

export const getRun = (runId: string) => runs.get(runId);
export const hasActiveRun = () => [...runs.values()].some((r) => !r.done);

/** Sum of confirmed spend across stored assessments, for the lifetime cap. */
export function lifetimeSpendAtomic(store: Store): bigint {
  return store.list().reduce((sum, r) => sum + r.bundle.signed.memo.cost.totals.reduce((s, t) => s + BigInt(t.amount_atomic), 0n), 0n);
}

/** Starts a run in the background and returns immediately. Progress reaches the page through its events. */
export function startRun(tokenInput: string, budgetAtomic: bigint, chain: TokenChain = "ethereum"): Run {
  const store = createStore();
  const run: Run = { runId: randomUUID(), events: [], listeners: new Set(), done: false, memoId: null, error: null };
  runs.set(run.runId, run);
  const emit = (event: AgentEvent) => {
    run.events.push(event);
    for (const l of run.listeners) l(event);
  };
  void (async () => {
    try {
      const result = await runAssessment(tokenInput, liveDeps(budgetAtomic, store, emit), chain);
      run.memoId = store.save(result, run.events);
    } catch (err) {
      run.error = err instanceof InputError ? err.message : `The assessment stopped: ${(err as Error).message}`;
      emit({ at: new Date().toISOString(), step: "validate", status: "failed", message: run.error });
    } finally {
      run.done = true;
      for (const l of run.listeners) l(null);
    }
  })();
  return run;
}
