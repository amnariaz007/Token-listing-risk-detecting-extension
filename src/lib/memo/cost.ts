import { formatUnits } from "viem";
import { USD_BASIS, type Check, type Cost, type CurrencyTotal, type Payment } from "./schema.ts";

type ConfirmedPayment = Payment & { amount_atomic: string; currency: string; decimals: number };

const isConfirmed = (p: Payment | null): p is ConfirmedPayment => p?.status === "confirmed";

/** USD face value of an atomic USDC amount. Null for every other currency: no verified conversion exists. */
export function usdFaceValue(amountAtomic: string, currency: string, decimals: number): number | null {
  return currency === "USDC" ? Number(formatUnits(BigInt(amountAtomic), decimals)) : null;
}

function sumByCurrency(payments: ConfirmedPayment[]): CurrencyTotal[] {
  const sums = new Map<string, { decimals: number; atomic: bigint }>();
  for (const p of payments) {
    const key = p.currency;
    const entry = sums.get(key) ?? { decimals: p.decimals, atomic: 0n };
    entry.atomic += BigInt(p.amount_atomic);
    sums.set(key, entry);
  }
  return [...sums.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([currency, { decimals, atomic }]) => ({
      currency,
      decimals,
      amount_atomic: atomic.toString(),
      amount: formatUnits(atomic, decimals),
    }));
}

/** Totals come from confirmed receipts only, in integer atomic units. Prices are never assumed. */
export function computeCost(checks: Check[]): Cost {
  const paid = checks.filter((c) => c.status === "ok" && isConfirmed(c.payment));
  const paidPayments = paid.map((c) => c.payment as ConfirmedPayment);
  const totals = sumByCurrency(paidPayments);

  const lineItems = paid.map((c) => {
    const p = c.payment as ConfirmedPayment;
    return {
      check: c.name,
      amount_atomic: p.amount_atomic,
      amount: formatUnits(BigInt(p.amount_atomic), p.decimals),
      currency: p.currency,
      cost_usd: usdFaceValue(p.amount_atomic, p.currency, p.decimals),
      receipt_reference: c.receipt_reference as string,
    };
  });

  const only = totals.length === 1 ? totals[0]! : null;
  const totalUsd = only ? usdFaceValue(only.amount_atomic, only.currency, only.decimals) : null;
  const usdPrices = new Set(lineItems.map((l) => l.cost_usd));
  const perCheck = usdPrices.size === 1 ? ([...usdPrices][0] ?? null) : null;

  const failedChecks = checks.filter((c) => c.status !== "ok");
  const failedSpend = failedChecks.map((c) => c.payment).filter(isConfirmed);

  return {
    per_check_usd: perCheck,
    checks_paid: paid.length,
    total_usd: totalUsd,
    usd_basis: totalUsd === null ? null : USD_BASIS,
    currency: only?.currency ?? null,
    totals,
    line_items: lineItems,
    failed_attempts: failedChecks.length,
    failed_attempt_spend: sumByCurrency(failedSpend),
  };
}
