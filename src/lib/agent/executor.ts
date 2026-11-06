import { createHash } from "node:crypto";
import { TEST_USDC } from "../../config/protocol.ts";
import { usdFaceValue } from "../memo/cost.ts";
import type { Check, Payment, RawEvidence } from "../memo/schema.ts";
import type { ConfirmedPayment, SettlementLedger } from "../blockchain/verifier.ts";
import { type Purchase } from "../telegraph/client.ts";
import type { SignalCheck } from "../telegraph/signal.ts";
import type { TokenTarget } from "./input.ts";
import type { PlannedCheck } from "./planner.ts";

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

async function confirm(purchase: Purchase, payer: string, ledger: SettlementLedger): Promise<{ confirmed: ConfirmedPayment | null; why: string | null }> {
  if (!purchase.paymentAttempted || !purchase.challenge) return { confirmed: null, why: "No payment was made for this request." };
  const { settlement, receipt, challenge } = purchase;
  if (settlement && !settlement.success) return { confirmed: null, why: `Settlement failed: ${settlement.errorReason ?? "no reason given"}.` };
  const txHash = receipt?.tx_hash ?? settlement?.transaction ?? null;
  if (!txHash || !TX_HASH.test(txHash)) return { confirmed: null, why: "The response carried no settlement transaction." };
  // The receipt says what this purchase cost. A settlement without one still uses the quote as the amount to find.
  const amount = receipt?.amount_uusdc != null ? String(receipt.amount_uusdc) : challenge.amountAtomic;
  if (!/^\d+$/.test(amount)) return { confirmed: null, why: "The receipt amount was malformed." };
  try {
    const confirmed = await ledger.confirm({ txHash, asset: TEST_USDC, payer, payTo: challenge.payTo, amountAtomic: BigInt(amount) });
    return { confirmed, why: null };
  } catch (err) {
    return { confirmed: null, why: `The settlement could not be verified on-chain: ${(err as Error).message}` };
  }
}

function buildPayment(purchase: Purchase, confirmed: ConfirmedPayment | null, payer: string): Payment | null {
  const { challenge, settlement, receipt } = purchase;
  if (!challenge || !purchase.paymentAttempted) return null;
  const tx = receipt?.tx_hash ?? settlement?.transaction ?? null;
  return {
    status: confirmed ? "confirmed" : "unconfirmed",
    quoted_amount_atomic: challenge.amountAtomic,
    amount_atomic: confirmed?.amountAtomic ?? null,
    amount: confirmed?.amount ?? null,
    decimals: confirmed?.decimals ?? null,
    currency: confirmed?.currency ?? null,
    asset: challenge.asset,
    network: challenge.network,
    tx_hash: tx && TX_HASH.test(tx) ? tx : null,
    payer: confirmed ? payer : null,
    pay_to: challenge.payTo,
    block_number: confirmed?.blockNumber ?? null,
  };
}

/** The miner's own answer text from a stored signal, if it has one. */
function verifiedAnswerOf(raw: unknown): string | null {
  const response = (raw as { payload?: { response?: unknown } } | null)?.payload?.response;
  const answer = response && typeof response === "object" ? (response as { answer?: unknown }).answer : null;
  return typeof answer === "string" ? answer : null;
}

/**
 * Tier 1: direct on-chain or registry reading. Tier 2: automated miner analysis. Tier 3: keyword or soft signal.
 * Tier 4: unverified. This rates one row's evidence, and is separate from the memo's overall confidence.
 */
export function tierOf(base: 1 | 2 | 3, status: Check["status"], signals: Check["signals"], signalVerified: boolean | null): number {
  if (status !== "ok" || signalVerified === false) return 4;
  if (signals.length === 0 || signals.every((s) => s.level === "inconclusive")) return 4;
  return base;
}

export type Executed = { check: Check; raw: RawEvidence };

/** Turns one purchase into a memo row and its raw evidence. Only verified purchases can become evidence. */
export async function evaluatePurchase(
  plan: Pick<PlannedCheck, "name" | "intent" | "interpret" | "tier">,
  purchase: Purchase,
  token: TokenTarget,
  deps: { payer: string; ledger: SettlementLedger; checkSignal: (hash: string) => Promise<SignalCheck> },
): Promise<Executed> {
  const { confirmed, why } = await confirm(purchase, deps.payer, deps.ledger);
  const delivered = purchase.error === null && purchase.httpStatus !== null && purchase.httpStatus >= 200 && purchase.httpStatus < 300;

  let body: unknown = null;
  try {
    body = JSON.parse(purchase.bodyText ?? "null");
  } catch {
    /* A body that is not JSON reads as inconclusive below. */
  }
  const envelope = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const signalHash = typeof envelope.signal_hash === "string" && envelope.signal_hash ? envelope.signal_hash : null;
  const signal = signalHash ? await deps.checkSignal(signalHash) : null;

  const receiptHash = purchase.receipt?.receipt_hash ?? null;
  let status: Check["status"];
  let failure: string | null = null;
  if (!delivered) {
    status = "failed";
    failure = purchase.error ?? `Telegraph returned HTTP ${purchase.httpStatus}`;
  } else if (!confirmed) {
    status = "unconfirmed";
    failure = why;
  } else if (!receiptHash) {
    status = "unconfirmed";
    failure = "The response carried no Telegraph receipt.";
  } else {
    status = "ok";
  }
  const interpretation = status === "ok" ? plan.interpret(body, token, signal?.verified === true ? verifiedAnswerOf(signal.raw) : null) : null;

  const check: Check = {
    name: plan.name,
    intent: plan.intent,
    miner_id: typeof envelope.miner_id === "string" || typeof envelope.miner_id === "number" ? String(envelope.miner_id) : null,
    finding: interpretation?.finding ?? null,
    status,
    failure_reason: failure,
    cost_usd: confirmed ? usdFaceValue(confirmed.amountAtomic, confirmed.currency, confirmed.decimals) : null,
    signal_hash: signalHash,
    signal_hash_status: signalHash ? "available" : "unavailable",
    signal_verified: signal?.verified ?? null,
    receipt_reference: status === "ok" ? receiptHash : null,
    request_id: purchase.requestId,
    raw_response_sha256: purchase.bodyBase64 ? createHash("sha256").update(Buffer.from(purchase.bodyBase64, "base64")).digest("hex") : null,
    signals: interpretation?.signals ?? [],
    tier: tierOf(plan.tier, status, interpretation?.signals ?? [], signal?.verified ?? null),
    payment: buildPayment(purchase, confirmed, deps.payer),
  };
  const raw: RawEvidence = {
    check: plan.name,
    method: "POST",
    url: purchase.url,
    request_body: purchase.requestBody,
    requested_at: purchase.requestedAt,
    responded_at: purchase.respondedAt,
    duration_ms: purchase.durationMs,
    exchanges: purchase.exchanges,
    challenge: purchase.challenge,
    settlement: purchase.settlement,
    receipt: purchase.receipt,
    signal: signal?.raw ?? null,
    body_base64: purchase.bodyBase64,
  };
  return { check, raw };
}
