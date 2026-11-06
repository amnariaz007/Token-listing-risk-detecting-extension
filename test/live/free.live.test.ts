import { describe, expect, it } from "vitest";
import { CANDIDATE_INTENTS, CANDIDATES } from "../../src/lib/agent/planner.ts";
import { findLargestPool } from "../../src/lib/agent/runtime.ts";
import { probePrice } from "../../src/lib/telegraph/client.ts";
import { discoverCapabilities, fetchNetworkStatus } from "../../src/lib/telegraph/discovery.ts";
import { checkSignal, deriveSignalHash } from "../../src/lib/telegraph/signal.ts";
import { readTokenIdentity } from "../../src/lib/blockchain/wallet.ts";
import { DIAMOND, TEST_USDC, nodeUrl } from "../../src/config/protocol.ts";

/* REAL NETWORK, NO PAYMENT. These call the Telegraph devnode and Sepolia, and spend nothing. */
describe("live Telegraph node (free calls)", () => {
  it("reports network status", async () => {
    const status = await fetchNetworkStatus();
    expect(status.online).toBe(true);
    expect(status.intents).toBeGreaterThan(0);
  }, 30_000);

  it("discovers the candidate intents and their schemas", async () => {
    const snapshot = await discoverCapabilities(CANDIDATE_INTENTS);
    const price = snapshot.capabilities.find((c) => c.intent === "CRYPTO_PRICE_USD")!;
    expect(price.miner_count).toBeGreaterThan(0);
    expect(price.params?.map((p) => p.name)).toContain("symbol");
    expect(price.response_fields?.map((f) => f.name)).toContain("price_usd");
  }, 60_000);

  it("every request this application would send matches the live schema", async () => {
    const snapshot = await discoverCapabilities(CANDIDATE_INTENTS);
    const token = { name: "Uniswap", symbol: "UNI", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", chain: "ethereum", identity_source: "onchain" as const };
    for (const candidate of CANDIDATES) {
      const capability = snapshot.capabilities.find((c) => c.intent === candidate.intent)!;
      const body = candidate.body(token, { pool: "0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801" });
      if (!capability.params || !body?.params) continue;
      const known = capability.params.map((p) => p.name);
      expect(Object.keys(body.params as object).every((k) => known.includes(k)), candidate.intent).toBe(true);
    }
  }, 60_000);

  it("returns a real 402 whose terms pass validation", async () => {
    const quote = await probePrice({ intent: "CRYPTO_PRICE_USD", params: { symbol: "BTC" } });
    expect(quote.status).toBe(402);
    expect(quote.challenge).toMatchObject({ network: "eip155:11155111", scheme: "exact" });
    expect(quote.challenge!.asset.toLowerCase()).toBe(TEST_USDC.toLowerCase());
    expect(quote.challenge!.payTo.toLowerCase()).toBe(DIAMOND.toLowerCase());
  }, 30_000);

  it("re-derives real signal hashes from the public feed", async () => {
    const res = await fetch(`${nodeUrl()}/daemon/api/questions?source=user&limit=20`);
    const { results } = (await res.json()) as { results: { signal_hash?: string }[] };
    const hashes = results.map((r) => r.signal_hash).filter((h): h is string => Boolean(h)).slice(0, 5);
    expect(hashes.length).toBeGreaterThan(0);
    for (const hash of hashes) expect((await checkSignal(hash)).verified, hash).toBe(true);
  }, 90_000);

  it("finds a real pool with the free DexScreener lookup", async () => {
    const pool = await findLargestPool({ name: "Uniswap", symbol: "UNI", address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", chain: "ethereum", identity_source: "onchain" });
    expect(pool).toMatch(/^0x[0-9a-fA-F]{40}$/);
  }, 30_000);

  it("resolves a real DEXScreener pair to its token, as the extension does", async () => {
    await import("../../extension/lib.js");
    const { tokenFromPair } = (globalThis as unknown as { ListingRisk: { tokenFromPair: (r: unknown, c: string) => { address: string } | null } }).ListingRisk;
    const res = await fetch("https://api.dexscreener.com/latest/dex/pairs/ethereum/0x1d42064Fc4Beb5F8aAF85F4617AE8b3b5B8Bd801");
    expect(tokenFromPair(await res.json(), "ethereum")?.address.toLowerCase()).toBe("0x1f9840a85d5af5bf1d1762f925bdaddc4201f984");
  }, 30_000);

  it("derives a different hash when a payload changes", () => {
    expect(deriveSignalHash({ a: 1 })).not.toBe(deriveSignalHash({ a: 2 }));
  });

  it("reads token identity from its own chain, with no mainnet funds", async () => {
    expect(await readTokenIdentity(TEST_USDC, "ethereum-sepolia")).toMatchObject({ symbol: "USDC", decimals: 6 });
    expect(await readTokenIdentity("0x000000000000000000000000000000000000dEaD", "ethereum-sepolia")).toBeNull();
    expect(await readTokenIdentity("0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", "ethereum")).toMatchObject({ symbol: "UNI" });
  }, 30_000);
});
