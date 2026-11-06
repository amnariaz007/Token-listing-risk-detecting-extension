/**
 * Values from https://anjoman.ai/docs/protocol/addresses-and-params and
 * https://anjoman.ai/docs/using/x402-inference, verified against live 402 challenges on 2026-11-06.
 * A challenge that disagrees with these is refused before anything is signed.
 */
export const NETWORK = {
  name: "ethereum-sepolia",
  label: "Ethereum Sepolia Testnet",
  kind: "testnet",
  chainId: 11155111,
  caip2: "eip155:11155111",
} as const;

/**
 * Chains a token under assessment can live on. These are read-only lookups: every payment stays on Sepolia.
 * The param value is the chain name Telegraph's forensic miners accept.
 */
export const TOKEN_CHAINS = {
  ethereum: { id: 1, rpc: "https://ethereum-rpc.publicnode.com", param: "ethereum", short: "eth", testnet: false },
  base: { id: 8453, rpc: "https://base-rpc.publicnode.com", param: "base", short: "base", testnet: false },
  arbitrum: { id: 42161, rpc: "https://arbitrum-one-rpc.publicnode.com", param: "arbitrum", short: "arbitrum", testnet: false },
  optimism: { id: 10, rpc: "https://optimism-rpc.publicnode.com", param: "optimism", short: "optimism", testnet: false },
  polygon: { id: 137, rpc: "https://polygon-bor-rpc.publicnode.com", param: "polygon", short: "polygon", testnet: false },
  "ethereum-sepolia": { id: 11155111, rpc: "https://ethereum-sepolia-rpc.publicnode.com", param: "sepolia", short: "sepolia", testnet: true },
} as const;
export type TokenChain = keyof typeof TOKEN_CHAINS;
export const isTokenChain = (value: unknown): value is TokenChain => typeof value === "string" && value in TOKEN_CHAINS;

export const TEST_USDC = "0xcc194e1a843B658526D0D5C431f670028582Ae17";
export const DIAMOND = "0x3624EB012B5E998BB57B6bE6C9Cfc9c4bc5eb99b";

export const nodeUrl = () => (process.env.TELEGRAPH_NODE_URL ?? "https://devnode.telegraphprotocol.com").replace(/\/$/, "");
export const rpcUrl = () => process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

function atomicEnv(name: string, fallback: string): bigint {
  const value = process.env[name] ?? fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${name} must be a whole number of atomic USDC units`);
  return BigInt(value);
}

/** Application safety limits in atomic USDC (1000000 = 1 USDC). These are not protocol prices. */
export const limits = () => ({
  maxAssessmentAtomic: atomicEnv("MAX_ASSESSMENT_ATOMIC", "70000"),
  maxRequestAtomic: atomicEnv("MAX_REQUEST_ATOMIC", "20000"),
  maxTotalAtomic: atomicEnv("MAX_TOTAL_ATOMIC", "5000000"),
  maxBatchAtomic: atomicEnv("MAX_BATCH_ATOMIC", "700000"),
  /** Checks planned per assessment. */
  maxChecks: Number(process.env.MAX_CHECKS ?? 6),
  /** Paid requests per assessment. One above maxChecks leaves room for a second source. */
  maxRequests: Number(process.env.MAX_REQUESTS ?? 7),
  concurrency: Number(process.env.REQUEST_CONCURRENCY ?? 3),
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 120_000),
});
