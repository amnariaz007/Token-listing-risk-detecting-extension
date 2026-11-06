import { createHash } from "node:crypto";
import { deriveSignalHash } from "../telegraph/signal.ts";
import { formatUsd, wrap } from "./render.ts";
import { TIER_MEANINGS, type Check, type EvidenceBundle, type RawEvidence, type SignedMemo } from "./schema.ts";

/** Wide enough that transaction references and hashes stay whole, so they can be copied from the PDF. */
export const APPENDIX_WIDTH = 104;
const DIVIDER = "-".repeat(50);
const NETWORK_LABELS: Record<string, string> = { "ethereum-sepolia": "Ethereum Sepolia Testnet" };

export function decodeBody(raw: RawEvidence | undefined): string | null {
  return raw?.body_base64 ? Buffer.from(raw.body_base64, "base64").toString("utf8") : null;
}

export function sha256OfBody(raw: RawEvidence): string | null {
  return raw.body_base64 ? createHash("sha256").update(Buffer.from(raw.body_base64, "base64")).digest("hex") : null;
}

function prettyBody(raw: RawEvidence | undefined): string {
  const text = decodeBody(raw);
  if (text === null) return "(no response body)";
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function checkBlock(c: Check, raw: RawEvidence | undefined, maxResultChars: number): string[] {
  const p = c.payment;
  const lines = [
    `Check: ${c.name}`,
    "",
    `status: ${c.status}`,
    ...(c.tier === undefined ? [] : [`tier: ${c.tier} (${TIER_MEANINGS[c.tier]})`]),
    `intent: ${c.intent}`,
    `miner_id: ${c.miner_id ?? "unavailable"}`,
    `cost_usd: ${c.cost_usd !== null ? formatUsd(c.cost_usd) : "not confirmed"}`,
    `payment_amount: ${p?.status === "confirmed" ? p.amount : "not confirmed"}`,
    `payment_currency: ${p?.currency ?? "not confirmed"}`,
    `signal_hash: ${c.signal_hash ?? "unavailable (not provided by the protocol)"}`,
    `signal_hash_rederived: ${c.signal_verified === null ? "not checked" : c.signal_verified ? "yes" : "NO, DOES NOT MATCH"}`,
    `transaction: ${p?.tx_hash ?? "unavailable"}`,
    `receipt_reference: ${c.receipt_reference ?? "unavailable"}`,
    `request_id: ${c.request_id ?? "unavailable"}`,
    `payer: ${p?.payer ?? "unavailable"}`,
    `raw_response_sha256: ${c.raw_response_sha256 ?? "unavailable"}`,
  ];
  if (p && p.status !== "confirmed") lines.push(`quoted_amount_atomic (not confirmed spend): ${p.quoted_amount_atomic}`);
  if (c.failure_reason) lines.push(`failure_reason: ${c.failure_reason}`);

  let body = prettyBody(raw);
  if (body.length > maxResultChars) {
    body = `${body.slice(0, maxResultChars)}\n... shortened here. The evidence bundle holds the complete response.`;
  }
  lines.push("", "result:", body);
  const original = (raw?.signal as { payload?: { response?: { answer?: unknown } } } | null | undefined)?.payload?.response?.answer;
  if (typeof original === "string" && c.signal_verified) {
    lines.push("", "original miner answer (from the verified signal):", original.length > maxResultChars ? `${original.slice(0, maxResultChars)}...` : original);
  }
  for (const detail of c.signals.flatMap((s) => s.details ?? [])) lines.push(`evidence: ${detail}`);
  return lines;
}

/**
 * Human-readable appendix for a signed memo. It reads the memo and the stored raw
 * responses, and it does not replace either. Long results are shortened only here.
 */
export function renderAppendix(bundle: EvidenceBundle, opts: { maxResultChars?: number } = {}): string {
  const { signed, raw_evidence } = bundle;
  const memo = signed.memo;
  const maxResultChars = opts.maxResultChars ?? 2500;
  const lines = [
    "APPENDIX: RAW RECEIPTS",
    "",
    `Assessment ID: ${memo.memo_id}`,
    `Network: ${NETWORK_LABELS[memo.payment_network] ?? memo.payment_network}`,
    `Token address: ${memo.token.address ?? "not resolved"}`,
    "",
    DIVIDER,
  ];
  for (const c of memo.checks) {
    lines.push("", ...checkBlock(c, raw_evidence.find((r) => r.check === c.name), maxResultChars), "", DIVIDER);
  }
  if (memo.checks_skipped.length > 0) {
    lines.push("", "SKIPPED CHECKS", "");
    for (const c of memo.checks_skipped) lines.push(`${c.name}:`, `Reason: ${c.reason}`, "");
    lines.push(DIVIDER);
  }
  const total = memo.cost.totals.map((t) => `${t.amount} ${t.currency}`).join(" + ") || "0";
  lines.push("", `TOTAL CONFIRMED SPENDING: ${total}`);
  if (memo.cost.usd_basis) lines.push(`USD figures: ${memo.cost.usd_basis}`);
  lines.push("", `MEMO HASH: ${signed.memo_hash}`, `SIGNER ADDRESS: ${signed.signer_address}`, `SIGNATURE: ${signed.signature}`, `SIGNATURE SCHEME: ${signed.scheme}`, "This signature is the application's own. It is not a Telegraph receipt or a miner signature.");
  return lines.flatMap((entry) => entry.split("\n")).flatMap(wrapPreservingIndent).join("\n");
}

function wrapPreservingIndent(line: string): string[] {
  if (line.length <= APPENDIX_WIDTH) return [line];
  const indent = line.match(/^\s*/)?.[0] ?? "";
  return wrap(line.trim(), APPENDIX_WIDTH - indent.length).map((l) => indent + l);
}

export function buildBundle(signed: SignedMemo, rawEvidence: RawEvidence[]): EvidenceBundle {
  return { format: "lrm-evidence-bundle/v1", signed, raw_evidence: rawEvidence };
}

/** Confirms each stored raw response still matches the hash signed into the memo. */
export function findRawEvidenceErrors(bundle: EvidenceBundle): string[] {
  const errors: string[] = [];
  for (const c of bundle.signed.memo.checks) {
    if (c.raw_response_sha256 === null) continue;
    const raw = bundle.raw_evidence.find((r) => r.check === c.name);
    if (!raw) errors.push(`Raw response for "${c.name}" is missing`);
    else if (sha256OfBody(raw) !== c.raw_response_sha256) errors.push(`Raw response for "${c.name}" does not match its signed hash`);
    // A stored signal can feed findings, so it must still hash to the signal hash signed into the memo.
    const payload = (raw?.signal as { payload?: Record<string, unknown> } | null | undefined)?.payload;
    if (payload && c.signal_hash && deriveSignalHash(payload).toLowerCase() !== c.signal_hash.toLowerCase()) {
      errors.push(`Stored signal for "${c.name}" does not match its signed hash`);
    }
  }
  return errors;
}
