import { TEST_USDC, TOKEN_CHAINS, isTokenChain } from "../../config/protocol.ts";
import type { SkippedCheck } from "../memo/schema.ts";
import type { Challenge } from "../telegraph/payments.ts";
import type { CapabilitySnapshot, IntentCapability } from "../telegraph/discovery.ts";
import type { TokenTarget } from "./input.ts";
import { interpretAudit, interpretFraud, interpretHolderCount, interpretLiquidity, interpretNews, interpretPrice, interpretSanctions, interpretTokenControls, interpretWashScan, type Interpreter } from "./interpret.ts";

export type PlanContext = { pool: string | null };

type Candidate = {
  name: string;
  intent: string;
  why: string;
  /** Default reliability when the answer is usable: 1 direct reading, 2 automated analysis, 3 keyword signal. */
  tier: 1 | 2 | 3;
  /** Miners suited to this question, best first. Empty means the network routes it. */
  preferred: string[];
  /** The miner answers in its own format, so the request goes to its API and only it can be used. */
  rawFrom?: { miner: string };
  /** Only these token chains can be served. Omitted means the check does not depend on a chain. */
  mainnetOnly?: boolean;
  /** Why the check cannot run when body returns null. */
  needs?: string;
  body: (token: TokenTarget, context: PlanContext) => Record<string, unknown> | null;
  interpret: Interpreter;
};

const chainOf = (t: TokenTarget) => (isTokenChain(t.chain) ? TOKEN_CHAINS[t.chain] : null);
const NEEDS_ADDRESS = "This check needs a contract address. A ticker does not identify one contract.";

/**
 * Checks in priority order. Forensic checks on a contract come first. News, fraud and price are
 * demoted: they run only when forensic checks cannot, which in practice means symbol input.
 * Whether each one runs is decided from the live registry, never from this list.
 */
export const CANDIDATES: Candidate[] = [
  {
    name: "Contract audit",
    intent: "SMART_CONTRACT_AUDIT_GENERAL",
    why: "Reviews the contract source for reentrancy, access-control and integer-overflow flaws.",
    tier: 2,
    preferred: [],
    rawFrom: { miner: "txlens" },
    mainnetOnly: true,
    needs: NEEDS_ADDRESS,
    body: (t) => {
      const chain = chainOf(t);
      return t.address && chain ? { method: "GET", endpoint: "/smart-contract-audit", payload: { contract: t.address, chain: chain.short } } : null;
    },
    interpret: interpretAudit,
  },
  {
    name: "Token controls",
    intent: "SMART_CONTRACT_AUDIT_GENERAL",
    why: "A different question from the audit: can the owner trap holders, and do a few wallets hold most of the supply?",
    tier: 2,
    preferred: [],
    rawFrom: { miner: "goplus-security" },
    mainnetOnly: true,
    needs: NEEDS_ADDRESS,
    body: (t) => {
      const chain = chainOf(t);
      return t.address && chain
        ? { intent: "SMART_CONTRACT_AUDIT_GENERAL", query: `Token security audit of the ERC-20 contract ${t.address} on ${chain.param} (chain id ${chain.id}): honeypot, taxes, owner privileges, proxy, mint.` }
        : null;
    },
    interpret: interpretTokenControls,
  },
  {
    name: "Sanctions screen",
    intent: "SANCTIONS_SCREENING_MATCH_GENERAL",
    why: "Screens the token's identity against consolidated sanctions lists.",
    tier: 1,
    preferred: [],
    needs: "Screening needs a contract address or full name. A ticker is not an identity, so a result would prove nothing.",
    body: (t) => (t.address || t.name ? { intent: "SANCTIONS_SCREENING_MATCH_GENERAL", params: { name: t.address ?? (t.name as string) } } : null),
    interpret: interpretSanctions,
  },
  {
    name: "Wash trading",
    intent: "WASH_TRADING_DETECTION_GENERAL",
    why: "Scans recent transfers on-chain for round-trip volume.",
    tier: 2,
    preferred: [],
    rawFrom: { miner: "verifywire-wash-trading" },
    mainnetOnly: true,
    needs: NEEDS_ADDRESS,
    body: (t) => {
      const chain = chainOf(t);
      return t.address && chain ? { method: "GET", endpoint: "/washtrade", payload: { chain: chain.param, token: t.address, blocks: 600 } } : null;
    },
    interpret: interpretWashScan,
  },
  {
    name: "Holder count",
    intent: "TOKEN_HOLDER_COUNT_GENERAL",
    why: "Reads how many distinct addresses hold the token.",
    tier: 1,
    preferred: ["chainwire-holder-count", "livecert", "txlens"],
    mainnetOnly: true,
    needs: NEEDS_ADDRESS,
    body: (t) => {
      const chain = chainOf(t);
      return t.address && chain ? { intent: "TOKEN_HOLDER_COUNT_GENERAL", params: { token: t.address, chain: chain.param } } : null;
    },
    interpret: interpretHolderCount,
  },
  {
    name: "Liquidity",
    intent: "LIQUIDITY_DEPTH_VERIFY_GENERAL",
    why: "Reads the reserve of the token's largest DEX pool, to flag thin markets.",
    tier: 1,
    preferred: ["verifywire-liquidity-depth", "zk-liq-verified"],
    mainnetOnly: true,
    needs: "No DEX pool was found for this token.",
    body: (t, { pool }) => {
      const chain = chainOf(t);
      return pool && chain ? { intent: "LIQUIDITY_DEPTH_VERIFY_GENERAL", params: { pool, chain: chain.param } } : null;
    },
    interpret: interpretLiquidity,
  },
  {
    name: "Market price",
    intent: "CRYPTO_PRICE_USD",
    why: "Shows whether the asset has a live market and confirms the symbol is recognized.",
    tier: 1,
    preferred: [],
    body: (t) => ({ intent: "CRYPTO_PRICE_USD", params: { symbol: t.symbol } }),
    interpret: interpretPrice,
  },
  {
    name: "Adverse media",
    intent: "NEWS_SEARCH_GENERAL",
    why: "Looks for recent hacks, exploits, lawsuits or regulatory action that a listing desk must review.",
    tier: 3,
    // The top-ranked miner for this intent searches spaceflight reports, so ranking alone is not enough.
    // Tested on 2026-11-06: ChainSight returned dated headlines on every try, while TxLens often found nothing.
    preferred: ["chainsight-oracle", "txlens", "newswire-search"],
    body: (t) => ({ intent: "NEWS_SEARCH_GENERAL", params: { query: `What is the latest negative news about the ${t.name ?? t.symbol} cryptocurrency, such as hacks, exploits or lawsuits?` } }),
    interpret: interpretNews,
  },
  {
    name: "Fraud screen",
    intent: "FRAUD_DETECTION_GENERAL",
    why: "Asks for a structured fraud verdict on the token.",
    tier: 2,
    preferred: [],
    body: (t) => ({ intent: "FRAUD_DETECTION_GENERAL", params: { subject: t.address ?? (t.name ? `${t.name} (${t.symbol})` : `${t.symbol} cryptocurrency`) } }),
    interpret: interpretFraud,
  },
];

export const CANDIDATE_INTENTS = [...new Set(CANDIDATES.map((c) => c.intent))];

export type PlannedCheck = {
  name: string;
  intent: string;
  why: string;
  tier: 1 | 2 | 3;
  body: Record<string, unknown>;
  miner_count: number;
  /** The miner to ask first. Null means the network routes the request. */
  miner: { id: string; slug: string | null } | null;
  /** Other suitable live miners, for a second source. */
  alternates: { id: string; slug: string | null }[];
  quoted_atomic: string;
  interpret: Interpreter;
};

export type Plan = {
  checks: PlannedCheck[];
  skipped: SkippedCheck[];
  /** Relevant and available, but left out by the check limit. Reported in the plan and the memo limitations. */
  not_selected: { name: string; intent: string; reason: string }[];
  expected_atomic: string;
  budget_atomic: string;
};

type Probe = (body: unknown, minerId?: string | null) => Promise<{ challenge: Challenge | null; status: number; error: string | null }>;

function unavailableReason(candidate: Candidate, capability: IntentCapability | undefined): string | null {
  if (!capability || capability.miner_count === 0) return "No live miner for this intent.";
  if (candidate.rawFrom) {
    return capability.miners.some((m) => m.slug === candidate.rawFrom?.miner) ? null : `The miner this check relies on (${candidate.rawFrom.miner}) is not live.`;
  }
  if (!capability.params || !capability.response_fields) return "Live miners exist, but the intent publishes no request or response format, so no result could be read reliably.";
  return null;
}

function paramsMatchSchema(body: Record<string, unknown>, capability: IntentCapability): boolean {
  const params = (body.params ?? {}) as Record<string, unknown>;
  const known = new Set((capability.params ?? []).map((p) => p.name));
  const missing = (capability.params ?? []).some((p) => p.required && !(p.name in params));
  return !missing && Object.keys(params).every((k) => known.has(k));
}

/** Picks checks from live capabilities, prices them with free unpaid requests, then fits them to the limits. */
export async function buildPlan(
  token: TokenTarget,
  snapshot: CapabilitySnapshot,
  context: PlanContext,
  limits: { budgetAtomic: bigint; maxRequestAtomic: bigint; maxChecks: number },
  probe: Probe,
): Promise<Plan> {
  const checks: PlannedCheck[] = [];
  const skipped: SkippedCheck[] = [];
  const not_selected: Plan["not_selected"] = [];
  let expected = 0n;
  const onTestnet = isTokenChain(token.chain) && TOKEN_CHAINS[token.chain].testnet;

  for (const candidate of CANDIDATES) {
    const skip = (reason: string) => skipped.push({ name: candidate.name, intent: candidate.intent, reason });
    if (checks.length >= limits.maxChecks) {
      not_selected.push({ name: candidate.name, intent: candidate.intent, reason: `The limit of ${limits.maxChecks} checks was reached by higher-priority checks.` });
      continue;
    }
    const capability = snapshot.capabilities.find((c) => c.intent === candidate.intent);
    const unavailable = unavailableReason(candidate, capability);
    if (unavailable) {
      skip(unavailable);
      continue;
    }
    if (candidate.mainnetOnly && onTestnet) {
      skip(`No live miner documents support for ${token.chain} contracts.`);
      continue;
    }
    const body = candidate.body(token, context);
    if (!body) {
      skip(candidate.needs ?? "This check does not apply to this token.");
      continue;
    }
    if (!candidate.rawFrom && !paramsMatchSchema(body, capability as IntentCapability)) {
      skip("The live request format no longer matches what this application sends.");
      continue;
    }
    // Availability comes from the live list, so a preferred miner that has left is simply not used.
    const live = (capability as IntentCapability).miners;
    const wanted = candidate.rawFrom ? [candidate.rawFrom.miner] : candidate.preferred;
    const suited = wanted.map((slug) => live.find((m) => m.slug === slug)).filter((m): m is IntentCapability["miners"][number] => Boolean(m));
    const quote = await probe(body, suited[0]?.id);
    if (!quote.challenge) {
      skip(quote.status === 503 ? "No compatible miner can serve this request right now." : `The node refused the request before payment (HTTP ${quote.status}).`);
      continue;
    }
    const amount = BigInt(quote.challenge.amountAtomic);
    if (quote.challenge.asset.toLowerCase() !== TEST_USDC.toLowerCase()) {
      skip("The quoted payment asset is not the documented test USDC.");
      continue;
    }
    if (amount > limits.maxRequestAtomic) {
      skip(`The quote of ${amount} atomic USDC exceeds the per-request limit of ${limits.maxRequestAtomic}.`);
      continue;
    }
    if (expected + amount > limits.budgetAtomic) {
      skip(`The quote of ${amount} atomic USDC does not fit the remaining budget of ${limits.budgetAtomic - expected}.`);
      continue;
    }
    expected += amount;
    checks.push({
      name: candidate.name,
      intent: candidate.intent,
      why: candidate.why,
      tier: candidate.tier,
      body,
      miner_count: (capability as IntentCapability).miner_count,
      miner: suited[0] ?? null,
      // Raw-format checks are read from one named miner, so another miner's answer could not be read.
      alternates: candidate.rawFrom ? [] : suited.slice(1),
      quoted_atomic: quote.challenge.amountAtomic,
      interpret: candidate.interpret,
    });
  }
  return { checks, skipped, not_selected, expected_atomic: expected.toString(), budget_atomic: limits.budgetAtomic.toString() };
}
