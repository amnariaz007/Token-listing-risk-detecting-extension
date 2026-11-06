import { sha256, toBytes } from "viem";
import type { Memo } from "./schema.ts";

/** Deterministic JSON per RFC 8785 (JCS): keys sorted by UTF-16 code unit, ES number formatting, no whitespace. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot canonicalize a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => {
        if (v === undefined) throw new Error(`Cannot canonicalize undefined at key "${k}"`);
        return `${JSON.stringify(k)}:${canonicalize(v)}`;
      });
    return `{${entries.join(",")}}`;
  }
  throw new Error(`Cannot canonicalize a value of type ${typeof value}`);
}

export function hashMemo(memo: Memo): `0x${string}` {
  return sha256(toBytes(canonicalize(memo)));
}
