import { canonicalize } from "./canonical.ts";
import { computeCost, usdFaceValue } from "./cost.ts";
import { MemoSchema, type Memo } from "./schema.ts";
import { computeConfidence, computeCoverage, computeVerdict, computeVerdictReason } from "./verdict.ts";

/** Evidence-integrity rules that a schema alone cannot express. Returns every violation found. */
export function findIntegrityViolations(memo: Memo): string[] {
  const errors: string[] = [];

  const names = [...memo.checks, ...memo.checks_skipped].map((c) => c.name);
  for (const name of new Set(names)) {
    if (names.filter((n) => n === name).length > 1) errors.push(`Check "${name}" is listed more than once`);
  }

  // Transactions may repeat, because the facilitator batches payments. Receipt hashes may not.
  const receipts = memo.checks.map((c) => c.receipt_reference).filter((r): r is string => r !== null);
  if (new Set(receipts).size !== receipts.length) errors.push("Two checks claim the same receipt");

  if (canonicalize(computeCoverage(memo.checks, memo.checks_skipped)) !== canonicalize(memo.coverage)) {
    errors.push("Coverage does not match the checks");
  }

  for (const c of memo.checks) {
    const where = `Check "${c.name}"`;
    if ((c.signal_hash === null) !== (c.signal_hash_status === "unavailable")) {
      errors.push(`${where}: signal_hash and signal_hash_status disagree`);
    }
    const paid = c.payment?.status === "confirmed" ? c.payment : null;
    const expectedUsd = paid ? usdFaceValue(paid.amount_atomic!, paid.currency!, paid.decimals!) : null;
    if (c.cost_usd !== expectedUsd) errors.push(`${where}: cost_usd does not match its receipt`);
    if (c.signal_verified !== null && c.signal_hash === null) errors.push(`${where}: cannot verify a missing signal hash`);
    if (c.status === "ok") {
      if (c.payment?.status !== "confirmed") errors.push(`${where}: successful evidence needs a confirmed payment`);
      if (c.receipt_reference === null) errors.push(`${where}: successful evidence needs a receipt reference`);
      if (c.raw_response_sha256 === null) errors.push(`${where}: successful evidence needs its raw response hash`);
      if (c.finding === null) errors.push(`${where}: successful evidence needs a finding`);
      if (c.signals.length === 0) errors.push(`${where}: successful evidence needs an interpretation`);
    } else {
      if (c.failure_reason === null) errors.push(`${where}: a ${c.status} check needs a reason`);
      if (c.finding !== null) errors.push(`${where}: a ${c.status} check cannot report a finding`);
      if (c.signals.length > 0) errors.push(`${where}: a ${c.status} check cannot contribute signals`);
    }
  }

  if (canonicalize(computeCost(memo.checks)) !== canonicalize(memo.cost)) {
    errors.push("Cost section does not match the confirmed receipts");
  }
  errors.push(...findArithmeticErrors(memo));

  const evidence = { checks: memo.checks, checks_skipped: memo.checks_skipped };
  if (computeVerdict(evidence) !== memo.verdict) errors.push("Verdict does not follow from the evidence");
  if (computeConfidence(evidence) !== memo.confidence) errors.push("Confidence does not follow from the evidence");
  if (computeVerdictReason(evidence) !== memo.verdict_reason) errors.push("Verdict reason does not follow from the evidence");

  return errors;
}

/** Re-adds the receipts directly from the checks, without using the cost calculator. */
function findArithmeticErrors(memo: Memo): string[] {
  const errors: string[] = [];
  const fromReceipts = new Map<string, bigint>();
  let paidChecks = 0;
  for (const c of memo.checks) {
    if (c.status !== "ok" || c.payment?.status !== "confirmed") continue;
    paidChecks += 1;
    const currency = c.payment.currency!;
    fromReceipts.set(currency, (fromReceipts.get(currency) ?? 0n) + BigInt(c.payment.amount_atomic!));
  }
  if (paidChecks !== memo.cost.checks_paid) errors.push("Paid-check count does not match the receipts");
  if (fromReceipts.size !== memo.cost.totals.length) errors.push("Currency totals do not match the receipts");
  for (const total of memo.cost.totals) {
    if (fromReceipts.get(total.currency) !== BigInt(total.amount_atomic)) {
      errors.push(`${total.currency} total does not equal the sum of its receipts`);
    }
  }
  return errors;
}

/** Throws unless the memo satisfies both the schema and every integrity rule. */
export function assertValidMemo(input: unknown): Memo {
  const memo = MemoSchema.parse(input);
  const errors = findIntegrityViolations(memo);
  if (errors.length > 0) throw new Error(`Invalid memo: ${errors.join("; ")}`);
  return memo;
}
