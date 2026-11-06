import { findRawEvidenceErrors } from "./appendix.ts";
import { EvidenceBundleSchema } from "./schema.ts";
import { verifySignedMemo, type VerificationResult } from "./sign.ts";

/** Verifies a whole evidence bundle: the signature, the integrity rules, and the raw responses against their signed hashes. */
export async function verifyBundle(input: unknown, expectedSigner?: string): Promise<VerificationResult> {
  const parsed = EvidenceBundleSchema.safeParse(input);
  if (!parsed.success) {
    return { valid: false, memo_hash: null, recovered_signer: null, errors: [`Bundle schema: ${parsed.error.message}`] };
  }
  const result = await verifySignedMemo(parsed.data.signed, expectedSigner);
  const errors = [...result.errors, ...findRawEvidenceErrors(parsed.data)];
  return { ...result, valid: errors.length === 0, errors };
}
