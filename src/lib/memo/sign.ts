import { recoverMessageAddress, type Hex, type LocalAccount } from "viem";
import { hashMemo } from "./canonical.ts";
import { SignedMemoSchema, type Memo, type SignedMemo } from "./schema.ts";
import { assertValidMemo, findIntegrityViolations } from "./validate.ts";
import { computeCost } from "./cost.ts";
import { computeConfidence, computeCoverage, computeVerdict, computeVerdictReason } from "./verdict.ts";

/**
 * Scheme lrm-sig/v1:
 *   memo_hash = sha256(utf8(RFC 8785 canonical JSON of the memo object))
 *   signature = EIP-191 personal_sign over the 32 raw bytes of memo_hash
 * This is the application's signature. It is separate from Telegraph receipts and is not a miner signature.
 */
export async function signMemo(memo: Memo, signer: Pick<LocalAccount, "address" | "signMessage">): Promise<SignedMemo> {
  const valid = assertValidMemo(memo);
  const memo_hash = hashMemo(valid);
  const signature = await signer.signMessage({ message: { raw: memo_hash } });
  return Object.freeze({
    scheme: "lrm-sig/v1",
    memo: valid,
    memo_hash,
    signer_address: signer.address,
    signature,
  }) as SignedMemo;
}

export type VerificationResult = {
  valid: boolean;
  memo_hash: string | null;
  recovered_signer: string | null;
  errors: string[];
};

/** Needs nothing but the signed memo itself. Pass `expectedSigner` to pin who must have signed it. */
export async function verifySignedMemo(input: unknown, expectedSigner?: string): Promise<VerificationResult> {
  const parsed = SignedMemoSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, memo_hash: null, recovered_signer: null, errors: [`Schema: ${parsed.error.message}`] };
  }
  const signed = parsed.data;
  const errors = findIntegrityViolations(signed.memo);

  const memo_hash = hashMemo(signed.memo);
  if (memo_hash !== signed.memo_hash) errors.push("Memo hash does not match the memo contents");

  let recovered: string | null = null;
  try {
    recovered = await recoverMessageAddress({ message: { raw: memo_hash }, signature: signed.signature as Hex });
  } catch (err) {
    errors.push(`Signature could not be read: ${(err as Error).message}`);
  }
  if (recovered && recovered.toLowerCase() !== signed.signer_address.toLowerCase()) {
    errors.push("Signature was not produced by the stated signer");
  }
  if (expectedSigner && signed.signer_address.toLowerCase() !== expectedSigner.toLowerCase()) {
    errors.push(`Signer ${signed.signer_address} is not the expected signer ${expectedSigner}`);
  }
  return { valid: errors.length === 0, memo_hash, recovered_signer: recovered, errors };
}

/** A signed memo is never edited. A correction is a new signed version that points at the old hash. */
export async function issueCorrection(
  previous: SignedMemo,
  changes: Partial<Pick<Memo, "token" | "checks" | "checks_skipped" | "limitations" | "disclaimer" | "generated_at" | "signed_at">>,
  signer: Pick<LocalAccount, "address" | "signMessage">,
): Promise<SignedMemo> {
  const merged = { ...previous.memo, ...changes };
  const evidence = { checks: merged.checks, checks_skipped: merged.checks_skipped };
  const next: Memo = {
    ...merged,
    version: previous.memo.version + 1,
    supersedes: previous.memo_hash as Hex,
    verdict: computeVerdict(evidence),
    verdict_reason: computeVerdictReason(evidence),
    confidence: computeConfidence(evidence),
    coverage: computeCoverage(merged.checks, merged.checks_skipped),
    cost: computeCost(merged.checks),
  };
  return signMemo(next, signer);
}
