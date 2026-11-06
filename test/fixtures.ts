import { privateKeyToAccount } from "viem/accounts";
import { assembleMemo } from "../src/lib/memo/assemble.ts";
import { buildBundle } from "../src/lib/memo/appendix.ts";
import type { Check, EvidenceBundle, Memo, RawEvidence, Signal, SkippedCheck } from "../src/lib/memo/schema.ts";
import { signMemo } from "../src/lib/memo/sign.ts";
import { createHash } from "node:crypto";

/**
 * SYNTHETIC TEST DATA. Nothing here came from Telegraph and no purchase was made.
 * The signer is Hardhat's public test account #0, so its signatures prove nothing outside tests.
 */
export const TEST_SIGNER = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
export const TEST_PAYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
export const TEST_ASSET = "0xcc194e1a843B658526D0D5C431f670028582Ae17";
export const TEST_PAY_TO = "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b";
export const TEST_TOKEN = { name: null, symbol: "TEST", address: "0x1234567890abcdef1234567890abcdef1234abcd", chain: "ethereum-sepolia", identity_source: "onchain" as const };

/** The raw response each fixture check was hashed from, so bundles hold matching evidence. */
const rawByCheck = new WeakMap<Check, RawEvidence>();

let txCounter = 0;
const nextTx = () => `0x${(++txCounter).toString(16).padStart(64, "0")}`;
export const clear = (topic: string): Signal => ({ level: "clear", code: `${topic}_clear`, topic, basis: "miner_reported", explanation: `${topic} clear` });
export const soft = (topic: string, explanation = `${topic} concern`): Signal => ({ level: "soft", code: `${topic}_soft`, topic, basis: "miner_reported", explanation });
export const hard = (topic: string): Signal => ({ level: "hard", code: `${topic}_hard`, topic, basis: "miner_reported", explanation: `Verified ${topic} red flag` });
export const inconclusiveSignal = (topic: string): Signal => ({ level: "inconclusive", code: "unknown", topic, basis: "miner_reported", explanation: "unknown" });

export function rawFor(name: string, result: unknown): RawEvidence {
  return {
    check: name,
    method: "GET",
    url: `https://fixture.invalid/${encodeURIComponent(name)}`,
    request_body: { intent: name },
    requested_at: "2026-11-06T07:44:30Z",
    responded_at: "2026-11-06T07:44:31Z",
    duration_ms: 1000,
    exchanges: [{ status: 402, headers: {} }, { status: 200, headers: { "x-request-id": `req-${name}` } }],
    challenge: null,
    settlement: null,
    receipt: null,
    signal: null,
    body_base64: Buffer.from(JSON.stringify(result)).toString("base64"),
  };
}

export function okCheck(name: string, signals: Signal[], opts: { atomic?: string; currency?: string; decimals?: number; signalHash?: string | null; result?: unknown; finding?: string } = {}): Check {
  const atomic = opts.atomic ?? "10000";
  const decimals = opts.decimals ?? 6;
  const currency = opts.currency ?? "USDC";
  const tx = nextTx();
  const raw = rawFor(name, opts.result ?? { fixture: name });
  const signalHash = opts.signalHash === undefined ? `0x${"ab".repeat(32)}` : opts.signalHash;
  const check: Check = {
    name,
    intent: `${name.toUpperCase().replace(/\s/g, "_")}_INTENT`,
    miner_id: "9002",
    finding: opts.finding ?? `${name} finding`,
    status: "ok",
    failure_reason: null,
    cost_usd: currency === "USDC" ? Number(atomic) / 10 ** decimals : null,
    signal_hash: signalHash,
    signal_hash_status: signalHash ? "available" : "unavailable",
    signal_verified: signalHash ? true : null,
    receipt_reference: `0xreceipt${tx.slice(9)}`,
    request_id: `req-${name}`,
    raw_response_sha256: createHash("sha256").update(Buffer.from(raw.body_base64!, "base64")).digest("hex"),
    signals,
    payment: {
      status: "confirmed",
      quoted_amount_atomic: atomic,
      amount_atomic: atomic,
      amount: String(Number(atomic) / 10 ** decimals),
      decimals,
      currency,
      asset: TEST_ASSET,
      network: "eip155:11155111",
      tx_hash: tx,
      payer: TEST_PAYER,
      pay_to: TEST_PAY_TO,
      block_number: "100",
    },
  };
  rawByCheck.set(check, raw);
  return check;
}

export const failedCheck = (name: string, reason = "Miner returned HTTP 500"): Check => ({
  name,
  intent: `${name.toUpperCase().replace(/\s/g, "_")}_INTENT`,
  miner_id: "9002",
  finding: null,
  status: "failed",
  failure_reason: reason,
  cost_usd: null,
  signal_hash: null,
  signal_hash_status: "unavailable",
  signal_verified: null,
  receipt_reference: null,
  request_id: null,
  raw_response_sha256: null,
  signals: [],
  payment: null,
});

export const skippedCheck = (name: string, reason = "No live miner for this intent."): SkippedCheck => ({ name, intent: null, reason });

export function memoFrom(checks: Check[], skipped: SkippedCheck[] = [], overrides: { memoId?: string; disclaimer?: string; token?: Memo["token"] } = {}): Memo {
  return assembleMemo({
    memoId: overrides.memoId ?? "LRM-2026-TST1",
    token: overrides.token ?? TEST_TOKEN,
    now: new Date("2026-11-06T07:44:30.500Z"),
    network: "testnet",
    paymentNetwork: "ethereum-sepolia",
    checks,
    checksSkipped: skipped,
    disclaimer: overrides.disclaimer,
  });
}

export async function bundleFrom(checks: Check[], skipped: SkippedCheck[] = [], overrides: Parameters<typeof memoFrom>[2] = {}): Promise<EvidenceBundle> {
  const memo = memoFrom(checks, skipped, overrides);
  const signed = await signMemo(memo, TEST_SIGNER);
  return buildBundle(signed, checks.flatMap((c) => rawByCheck.get(c) ?? []));
}

/** A representative CAUTION memo: two paid checks, one skipped. */
export const cautionBundle = () =>
  bundleFrom(
    [
      okCheck("Market price", [clear("price")], { signalHash: null }),
      okCheck("Adverse media", [soft("reputation", "Recent adverse media needs review")]),
    ],
    [skippedCheck("Contract audit")],
  );
