import { z } from "zod";

const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const atomic = z.string().regex(/^\d+$/);

export const DEFAULT_DISCLAIMER = "Testnet run. Intelligence bought via Telegraph. Not financial advice.";

export const TIER_MEANINGS: Record<number, string> = {
  1: "Direct on-chain or registry reading",
  2: "Automated miner analysis",
  3: "Keyword or soft signal",
  4: "Unverified: no usable or confirmed result",
};

export const NO_PURCHASE_DISCLAIMER = "Testnet run. No intelligence was purchased. Not financial advice.";

/**
 * How `cost_usd` values are derived. USD figures exist only for USDC, at face value.
 * No market conversion is performed, and testnet USDC has no market value.
 */
export const USD_BASIS = "USDC face value (1 USDC = $1); not a market conversion";

export const SignalSchema = z.strictObject({
  /** superseded = this source gave no usable answer and a second source replaced it. */
  level: z.enum(["hard", "soft", "clear", "inconclusive", "superseded"]),
  code: z.string().min(1),
  /** Two signals on one topic that disagree count as a source conflict. */
  topic: z.string().min(1),
  /** Whether this repeats what a miner reported or is this application's inference from it. */
  basis: z.enum(["miner_reported", "inference"]),
  explanation: z.string().min(1),
  /** The specific evidence behind the signal, such as headlines. */
  details: z.array(z.string()).optional(),
});

export const PaymentSchema = z
  .strictObject({
    /** confirmed = the settlement was read back from the chain. */
    status: z.enum(["confirmed", "unconfirmed"]),
    quoted_amount_atomic: atomic,
    amount_atomic: atomic.nullable(),
    amount: z.string().nullable(),
    decimals: z.number().int().min(0).max(36).nullable(),
    currency: z.string().min(1).nullable(),
    asset: evmAddress,
    network: z.string().min(1),
    tx_hash: hex32.nullable(),
    payer: evmAddress.nullable(),
    pay_to: evmAddress,
    block_number: z.string().nullable(),
  })
  .superRefine((p, ctx) => {
    if (p.status !== "confirmed") return;
    const required = ["amount_atomic", "amount", "decimals", "currency", "tx_hash", "payer", "block_number"] as const;
    for (const field of required) {
      if (p[field] === null) ctx.addIssue({ code: "custom", path: [field], message: "required on a confirmed payment" });
    }
  });

export const CheckSchema = z.strictObject({
  name: z.string().min(1),
  intent: z.string().min(1),
  miner_id: z.string().min(1).nullable(),
  finding: z.string().nullable(),
  /** ok = result delivered and payment verified. unconfirmed = result delivered, payment not verified. */
  status: z.enum(["ok", "failed", "unconfirmed"]),
  failure_reason: z.string().nullable(),
  cost_usd: z.number().nonnegative().nullable(),
  signal_hash: z.string().min(1).nullable(),
  signal_hash_status: z.enum(["available", "unavailable"]),
  /** True when the hash was re-derived from the stored signal. Null when it could not be checked. */
  signal_verified: z.boolean().nullable(),
  receipt_reference: z.string().min(1).nullable(),
  request_id: z.string().nullable(),
  raw_response_sha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  signals: z.array(SignalSchema),
  /** How much this row's evidence can be relied on: see TIER_MEANINGS. Absent only on memos signed before tiers existed. */
  tier: z.number().int().min(1).max(4).optional(),
  payment: PaymentSchema.nullable(),
});

export const SkippedCheckSchema = z.strictObject({
  name: z.string().min(1),
  intent: z.string().min(1).nullable(),
  reason: z.string().min(1),
});

export const CurrencyTotalSchema = z.strictObject({
  currency: z.string().min(1),
  decimals: z.number().int().min(0).max(36),
  amount_atomic: atomic,
  amount: z.string(),
});

export const CostSchema = z.strictObject({
  /** Set only when every paid check cost the same USD amount. */
  per_check_usd: z.number().nonnegative().nullable(),
  checks_paid: z.number().int().nonnegative(),
  total_usd: z.number().nonnegative().nullable(),
  usd_basis: z.string().nullable(),
  currency: z.string().nullable(),
  totals: z.array(CurrencyTotalSchema),
  line_items: z.array(
    z.strictObject({
      check: z.string(),
      amount_atomic: atomic,
      amount: z.string(),
      currency: z.string(),
      cost_usd: z.number().nonnegative().nullable(),
      receipt_reference: z.string(),
    }),
  ),
  failed_attempts: z.number().int().nonnegative(),
  /** Confirmed spend on attempts that returned no usable result. Never part of the paid total. */
  failed_attempt_spend: z.array(CurrencyTotalSchema),
});

export const MemoSchema = z.strictObject({
  memo_id: z.string().regex(/^LRM-\d{4}-[0-9A-Z]{4,}$/),
  version: z.number().int().min(1),
  /** Memo hash of the version this one corrects. */
  supersedes: hex32.nullable(),
  token: z.strictObject({
    name: z.string().min(1).nullable(),
    symbol: z.string().min(1),
    /** Null when the input was a symbol, which cannot be resolved to one contract without guessing. */
    address: evmAddress.nullable(),
    chain: z.string().min(1),
    identity_source: z.enum(["onchain", "user_input"]),
  }),
  generated_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
  signed_at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/),
  network: z.enum(["testnet", "mainnet"]),
  payment_network: z.string().min(1),
  verdict: z.enum(["CLEAR", "CAUTION", "HIGH RISK"]),
  verdict_reason: z.string().min(1),
  confidence: z.enum(["high", "medium", "low"]),
  coverage: z.strictObject({ planned: z.number().int().nonnegative(), executed: z.number().int().nonnegative() }),
  limitations: z.array(z.string().min(1)),
  checks: z.array(CheckSchema),
  checks_skipped: z.array(SkippedCheckSchema),
  cost: CostSchema,
  disclaimer: z.string().min(1),
});

export const SignedMemoSchema = z.strictObject({
  scheme: z.literal("lrm-sig/v1"),
  memo: MemoSchema,
  memo_hash: hex32,
  signer_address: evmAddress,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});

export const RawExchangeSchema = z.strictObject({
  status: z.number().int(),
  headers: z.record(z.string(), z.string()),
});

/** The original protocol exchange, kept apart from the human-readable appendix. Never holds payment signatures. */
export const RawEvidenceSchema = z.strictObject({
  check: z.string(),
  method: z.string(),
  url: z.string(),
  request_body: z.unknown(),
  requested_at: z.string().nullable(),
  responded_at: z.string().nullable(),
  duration_ms: z.number().nullable(),
  exchanges: z.array(RawExchangeSchema),
  challenge: z.unknown(),
  settlement: z.unknown(),
  receipt: z.unknown(),
  signal: z.unknown(),
  body_base64: z.string().nullable(),
});

export const EvidenceBundleSchema = z.strictObject({
  format: z.literal("lrm-evidence-bundle/v1"),
  signed: SignedMemoSchema,
  raw_evidence: z.array(RawEvidenceSchema),
});

export type Signal = z.infer<typeof SignalSchema>;
export type Payment = z.infer<typeof PaymentSchema>;
export type Check = z.infer<typeof CheckSchema>;
export type SkippedCheck = z.infer<typeof SkippedCheckSchema>;
export type CurrencyTotal = z.infer<typeof CurrencyTotalSchema>;
export type Cost = z.infer<typeof CostSchema>;
export type Memo = z.infer<typeof MemoSchema>;
export type SignedMemo = z.infer<typeof SignedMemoSchema>;
export type RawEvidence = z.infer<typeof RawEvidenceSchema>;
export type EvidenceBundle = z.infer<typeof EvidenceBundleSchema>;
