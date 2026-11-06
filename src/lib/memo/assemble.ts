import { randomInt } from "node:crypto";
import { computeCost } from "./cost.ts";
import { DEFAULT_DISCLAIMER, NO_PURCHASE_DISCLAIMER, type Check, type Memo, type SkippedCheck } from "./schema.ts";
import { assertValidMemo } from "./validate.ts";
import { computeConfidence, computeCoverage, computeVerdict, computeVerdictReason } from "./verdict.ts";

const ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

export function generateMemoId(now: Date): string {
  const suffix = Array.from({ length: 4 }, () => ID_ALPHABET[randomInt(ID_ALPHABET.length)]).join("");
  return `LRM-${now.getUTCFullYear()}-${suffix}`;
}

export function toMemoTimestamp(now: Date): string {
  return `${now.toISOString().slice(0, 19)}Z`;
}

export type AssembleInput = {
  memoId: string;
  token: Memo["token"];
  now: Date;
  signedAt?: Date;
  network: Memo["network"];
  paymentNetwork: string;
  checks: Check[];
  checksSkipped: SkippedCheck[];
  limitations?: string[];
  disclaimer?: string;
};

/** The one place a memo object is created. Every output format derives from what this returns. */
export function assembleMemo(input: AssembleInput): Memo {
  const evidence = { checks: input.checks, checks_skipped: input.checksSkipped };
  return assertValidMemo({
    memo_id: input.memoId,
    version: 1,
    supersedes: null,
    token: input.token,
    generated_at: toMemoTimestamp(input.now),
    signed_at: toMemoTimestamp(input.signedAt ?? input.now),
    network: input.network,
    payment_network: input.paymentNetwork,
    verdict: computeVerdict(evidence),
    verdict_reason: computeVerdictReason(evidence),
    confidence: computeConfidence(evidence),
    coverage: computeCoverage(input.checks, input.checksSkipped),
    limitations: input.limitations ?? [],
    checks: input.checks,
    checks_skipped: input.checksSkipped,
    cost: computeCost(input.checks),
    disclaimer: input.disclaimer ?? (input.checks.some((c) => c.status === "ok") ? DEFAULT_DISCLAIMER : NO_PURCHASE_DISCLAIMER),
  });
}
