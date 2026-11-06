import { ExactEvmScheme, toClientEvmSigner } from "@x402/evm";
import { x402Client } from "@x402/fetch";
import type { LocalAccount, PublicClient } from "viem";
import { DIAMOND, NETWORK, TEST_USDC } from "../../config/protocol.ts";

export type Challenge = { amountAtomic: string; asset: string; network: string; payTo: string; scheme: string; maxTimeoutSeconds: number | null };

export class PaymentRefused extends Error {}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Reads the 402 terms and refuses anything other than documented test USDC, on Sepolia, to the Diamond. */
export function parseChallenge(headers: Headers): Challenge {
  const header = headers.get("payment-required");
  if (!header) throw new PaymentRefused("The 402 response carried no payment terms.");
  let terms: { accepts?: Record<string, unknown>[] };
  try {
    terms = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
  } catch {
    throw new PaymentRefused("The 402 payment terms could not be read.");
  }
  const offer = terms.accepts?.find((a) => a.scheme === "exact");
  if (!offer) throw new PaymentRefused("The node did not offer the x402 exact scheme.");
  const { amount, asset, network, payTo, maxTimeoutSeconds } = offer;
  if (typeof amount !== "string" || !/^\d+$/.test(amount)) throw new PaymentRefused("The quoted amount was malformed.");
  if (network !== NETWORK.caip2) throw new PaymentRefused(`Refused: payment network ${String(network)} is not Ethereum Sepolia.`);
  if (typeof asset !== "string" || !same(asset, TEST_USDC)) throw new PaymentRefused(`Refused: asset ${String(asset)} is not the documented test USDC.`);
  if (typeof payTo !== "string" || !same(payTo, DIAMOND)) throw new PaymentRefused(`Refused: recipient ${String(payTo)} is not the documented Telegraph Diamond.`);
  return { amountAtomic: amount, asset, network, payTo, scheme: "exact", maxTimeoutSeconds: typeof maxTimeoutSeconds === "number" ? maxTimeoutSeconds : null };
}

/** Holds spending for one assessment. Amounts are reserved before signing, so parallel requests cannot overrun it. */
export class Budget {
  private spent = 0n;
  private count = 0;
  constructor(
    readonly limitAtomic: bigint,
    readonly perRequestAtomic: bigint,
    readonly maxRequests: number,
  ) {}

  reserve(amountAtomic: bigint) {
    if (amountAtomic > this.perRequestAtomic) throw new PaymentRefused(`Refused: quote of ${amountAtomic} exceeds the per-request limit of ${this.perRequestAtomic} atomic USDC.`);
    if (this.spent + amountAtomic > this.limitAtomic) throw new PaymentRefused(`Refused: quote of ${amountAtomic} would exceed the assessment budget of ${this.limitAtomic} atomic USDC.`);
    if (this.count >= this.maxRequests) throw new PaymentRefused(`Refused: the limit of ${this.maxRequests} paid requests was reached.`);
    this.spent += amountAtomic;
    this.count += 1;
  }

  release(amountAtomic: bigint) {
    this.spent -= amountAtomic;
    this.count -= 1;
  }

  get reservedAtomic() {
    return this.spent;
  }

  get requestCount() {
    return this.count;
  }
}

/**
 * The test USDC is not a built-in x402 token, so the library needs it allow-listed (per the Telegraph docs).
 * Sepolia is the only registered network, and the one listed asset carries a per-payment cap.
 */
export function createPaymentClient(account: LocalAccount, publicClient: PublicClient, maxRequestAtomic: bigint) {
  return x402Client.fromConfig({
    schemes: [{ network: NETWORK.caip2, client: new ExactEvmScheme(toClientEvmSigner(account as never, publicClient as never)) }],
    spendControls: { allowedAssets: [{ network: NETWORK.caip2, asset: TEST_USDC, maxAmountPerPayment: maxRequestAtomic.toString() }] },
  });
}
