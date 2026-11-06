import { keccak256, toBytes } from "viem";
import { z } from "zod";
import { nodeUrl } from "../../config/protocol.ts";

const SignalResponse = z.looseObject({
  signal_hash: z.string(),
  payload: z.record(z.string(), z.unknown()).nullish(),
  signal: z.looseObject({ wallet_address: z.string().nullish() }).nullish(),
  verification: z.unknown().optional(),
});

const escapeHtmlChars = (s: string) => s.replace(/[<>&]/g, (c) => `\\u00${c.charCodeAt(0).toString(16)}`);

function compactSorted(value: unknown): string {
  if (value === null || typeof value !== "object") return escapeHtmlChars(JSON.stringify(value));
  if (Array.isArray(value)) return `[${value.map(compactSorted).join(",")}]`;
  const entries = Object.keys(value as object)
    .sort()
    .map((k) => `${escapeHtmlChars(JSON.stringify(k))}:${compactSorted((value as Record<string, unknown>)[k])}`);
  return `{${entries.join(",")}}`;
}

/** Telegraph's documented recipe: keccak256 of compact, key-sorted JSON, with wallet_address lowercased and <, >, & escaped. */
export function deriveSignalHash(payload: Record<string, unknown>): string {
  const copy = { ...payload };
  if (typeof copy.wallet_address === "string") copy.wallet_address = copy.wallet_address.toLowerCase();
  return keccak256(toBytes(compactSorted(copy)));
}

export type SignalCheck = { verified: boolean | null; wallet: string | null; detail: string; raw: unknown };

/** Fetches the stored signal and re-derives its hash here, instead of trusting the node's own flag. */
export async function checkSignal(hash: string, fetchImpl: typeof fetch = fetch): Promise<SignalCheck> {
  try {
    const res = await fetchImpl(`${nodeUrl()}/engine/v1/signal/${hash}`, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return { verified: null, wallet: null, detail: `Signal lookup returned HTTP ${res.status}`, raw: null };
    const raw: unknown = await res.json();
    const signal = SignalResponse.parse(raw);
    if (!signal.payload) return { verified: null, wallet: null, detail: "Signal record had no payload", raw };
    const derived = deriveSignalHash(signal.payload);
    return {
      verified: derived.toLowerCase() === hash.toLowerCase(),
      wallet: signal.signal?.wallet_address ?? null,
      detail: derived.toLowerCase() === hash.toLowerCase() ? "Hash re-derived from the stored payload" : `Derived ${derived}`,
      raw,
    };
  } catch (err) {
    return { verified: null, wallet: null, detail: `Signal lookup failed: ${(err as Error).message}`, raw: null };
  }
}
