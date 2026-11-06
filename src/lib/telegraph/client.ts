import { z } from "zod";
import { decodePaymentResponseHeader } from "@x402/fetch";
import { nodeUrl } from "../../config/protocol.ts";
import { PaymentRefused, parseChallenge, type Budget, type Challenge } from "./payments.ts";

export type PayFetchFactory = (baseFetch: typeof fetch) => typeof fetch;
export type Exchange = { status: number; headers: Record<string, string> };

export const ReceiptSchema = z.looseObject({
  receipt_hash: z.string().min(1),
  rail: z.string().nullish(),
  payer: z.string().nullish(),
  miner: z.union([z.string(), z.number()]).nullish(),
  intent: z.string().nullish(),
  amount_uusdc: z.union([z.string(), z.number()]).nullish(),
  epoch_id: z.union([z.string(), z.number()]).nullish(),
  settlement: z.string().nullish(),
  chain: z.string().nullish(),
  tx_hash: z.string().nullish(),
  timestamp: z.union([z.string(), z.number()]).nullish(),
});
export type Receipt = z.infer<typeof ReceiptSchema>;

export type Settlement = { success: boolean; transaction: string; network: string; payer: string | null; errorReason: string | null };

export type Purchase = {
  intent: string;
  url: string;
  requestBody: unknown;
  requestedAt: string;
  respondedAt: string | null;
  durationMs: number | null;
  exchanges: Exchange[];
  challenge: Challenge | null;
  paymentAttempted: boolean;
  httpStatus: number | null;
  bodyBase64: string | null;
  bodyText: string | null;
  settlement: Settlement | null;
  receipt: Receipt | null;
  requestId: string | null;
  error: string | null;
  /** True when no payment left this process, so the error was before any spend. */
  refusedBeforePayment: boolean;
};

function toHeaderRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  // Network and cookie noise is dropped. Our own PAYMENT-SIGNATURE is a request header and is never recorded.
  headers.forEach((value, key) => {
    if (!/^(set-cookie|report-to|nel|cf-ray|alt-svc|server)$/i.test(key)) out[key.toLowerCase()] = value;
  });
  return out;
}

function readSettlement(headers: Headers): Settlement | null {
  const header = headers.get("payment-response") ?? headers.get("x-payment-response");
  if (!header) return null;
  try {
    const s = decodePaymentResponseHeader(header);
    return { success: s.success, transaction: s.transaction, network: s.network, payer: s.payer ?? null, errorReason: s.errorReason ?? null };
  } catch {
    return null;
  }
}

function readReceipt(headers: Headers): Receipt | null {
  const header = headers.get("x-telegraph-receipt");
  if (!header) return null;
  try {
    return ReceiptSchema.parse(JSON.parse(Buffer.from(header, "base64").toString("utf8")));
  } catch {
    return null;
  }
}

function rejectionReason(res: Response, bodyText: string): string {
  try {
    const body = JSON.parse(bodyText) as { reason?: string; error?: string };
    if (body?.reason) return body.reason;
  } catch {
    /* Fall through to the header. */
  }
  const header = res.headers.get("payment-required");
  if (header) {
    try {
      const terms = JSON.parse(Buffer.from(header, "base64").toString("utf8")) as { error?: string };
      if (terms.error && terms.error !== "Payment required") return terms.error;
    } catch {
      /* A malformed header leaves no reason to report. */
    }
  }
  return "the node gave no reason";
}

const FRIENDLY_REJECTIONS: [RegExp, string][] = [
  [/insufficient_funds|insufficient/i, "The wallet does not hold enough test USDC. Run: npm run fund"],
  [/expired|valid_?before/i, "The payment authorization expired before it could settle. Start a new assessment."],
];

export function explainRejection(reason: string): string {
  const hit = FRIENDLY_REJECTIONS.find(([rx]) => rx.test(reason));
  return `Payment rejected: ${reason}.${hit ? ` ${hit[1]}` : ""}`;
}

const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);

export type ClientOptions = {
  payFetch: PayFetchFactory;
  budget: Budget;
  baseFetch?: typeof fetch;
  timeoutMs?: number;
  /** Sends the request to one miner. Without it, the network routes the request. */
  minerId?: string | null;
  /** The exact request body, for a miner's own API. Defaults to the typed intent form. */
  body?: unknown;
  onEvent?: (event: { type: "challenge"; challenge: Challenge } | { type: "paying" }) => void;
};

const askUrl = (minerId?: string | null) => `${nodeUrl()}/engine/v1/ask${minerId ? `/${encodeURIComponent(minerId)}` : ""}`;

/** Reads the price with an unpaid request. This costs nothing, because no payment header is sent. */
export async function probePrice(body: unknown, minerId?: string | null, fetchImpl: typeof fetch = fetch): Promise<{ challenge: Challenge | null; status: number; error: string | null }> {
  try {
    const res = await fetchImpl(askUrl(minerId), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status !== 402) return { challenge: null, status: res.status, error: (await res.text()).slice(0, 300) };
    return { challenge: parseChallenge(res.headers), status: 402, error: null };
  } catch (err) {
    return { challenge: null, status: 0, error: (err as Error).message };
  }
}

/** Makes one paid request. Every outcome comes back as a record, and a paid attempt is never retried. */
export async function buyIntelligence(intent: string, params: Record<string, unknown>, options: ClientOptions): Promise<Purchase> {
  const url = askUrl(options.minerId);
  const requestBody = options.body ?? { intent, params };
  const purchase: Purchase = {
    intent, url, requestBody,
    requestedAt: new Date().toISOString(),
    respondedAt: null, durationMs: null, exchanges: [], challenge: null, paymentAttempted: false,
    httpStatus: null, bodyBase64: null, bodyText: null, settlement: null, receipt: null, requestId: null, error: null,
    refusedBeforePayment: false,
  };
  const baseFetch = options.baseFetch ?? fetch;
  const started = Date.now();
  let reserved: bigint | null = null;

  // Sees each HTTP exchange, and vets the 402 terms before the x402 library can sign them.
  const recording: typeof fetch = async (input, init) => {
    if (purchase.exchanges.length > 0) {
      purchase.paymentAttempted = true;
      options.onEvent?.({ type: "paying" });
    }
    const res = await baseFetch(input, init);
    purchase.exchanges.push({ status: res.status, headers: toHeaderRecord(res.headers) });
    if (res.status === 402 && purchase.exchanges.length === 1) {
      const challenge = parseChallenge(res.headers);
      purchase.challenge = challenge;
      options.onEvent?.({ type: "challenge", challenge });
      options.budget.reserve(BigInt(challenge.amountAtomic));
      reserved = BigInt(challenge.amountAtomic);
    }
    return res;
  };

  const releaseReservation = () => {
    if (reserved !== null) options.budget.release(reserved);
    reserved = null;
  };

  const payingFetch = options.payFetch(recording);
  const init = (): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await payingFetch(url, init());
      const bytes = Buffer.from(await res.arrayBuffer());
      purchase.bodyBase64 = bytes.toString("base64");
      purchase.bodyText = bytes.toString("utf8");
      purchase.httpStatus = res.status;
      purchase.settlement = readSettlement(res.headers);
      purchase.receipt = readReceipt(res.headers);
      purchase.requestId = res.headers.get("x-request-id");
      if (res.status === 402) purchase.error = explainRejection(rejectionReason(res, purchase.bodyText));
      else if (!res.ok) purchase.error = `Telegraph returned HTTP ${res.status}: ${purchase.bodyText.slice(0, 200)}`;
      const retryable = TRANSIENT_STATUS.has(res.status) && !purchase.paymentAttempted && attempt === 0;
      if (!retryable) break;
      releaseReservation();
      purchase.error = null;
      purchase.exchanges = [];
      await new Promise((r) => setTimeout(r, 1500));
    } catch (err) {
      purchase.error = (err as Error).message;
      purchase.refusedBeforePayment = err instanceof PaymentRefused || !purchase.paymentAttempted;
      if (err instanceof PaymentRefused || purchase.paymentAttempted || attempt === 1) break;
      // A network failure before any payment left is safe to retry once.
      releaseReservation();
      purchase.error = null;
      purchase.exchanges = [];
    }
  }

  if (!purchase.paymentAttempted) {
    purchase.refusedBeforePayment = true;
    releaseReservation();
  }
  purchase.respondedAt = new Date().toISOString();
  purchase.durationMs = Date.now() - started;
  return purchase;
}
