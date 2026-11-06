import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { isTokenChain, limits } from "@/config/protocol.ts";
import { guardSpending } from "@/lib/agent/guard.ts";
import { hasActiveBatch } from "@/lib/agent/batch.ts";
import { hasActiveRun, lifetimeSpendAtomic, startRun } from "@/lib/agent/runtime.ts";
import { MissingWalletError, paymentAccount } from "@/lib/blockchain/wallet.ts";
import { createStore } from "@/lib/storage/assessments.ts";

const Body = z.object({ token: z.string().max(100), chain: z.string().optional(), budget_usdc: z.number().positive().finite().optional() });

export async function GET() {
  return NextResponse.json(createStore().list().map(({ id, bundle: { signed: { memo } }, summary }) => ({
    id, symbol: memo.token.symbol, verdict: memo.verdict, confidence: memo.confidence, coverage: memo.coverage, cost: memo.cost.totals, summary,
  })));
}

/** Starting a run spends from the wallet, so see guardSpending for who may do it. */
export async function POST(req: NextRequest) {
  const refused = guardSpending(req);
  if (refused) return refused;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a token and a positive budget." }, { status: 400 });
  const chain = parsed.data.chain ?? "ethereum";
  if (!isTokenChain(chain)) return NextResponse.json({ error: `Unsupported chain: ${chain}` }, { status: 400 });

  try {
    paymentAccount();
  } catch (err) {
    if (err instanceof MissingWalletError) return NextResponse.json({ error: err.message }, { status: 503 });
    throw err;
  }
  const l = limits();
  const requested = parsed.data.budget_usdc === undefined ? l.maxAssessmentAtomic : BigInt(Math.floor(parsed.data.budget_usdc * 1e6));
  if (requested > l.maxAssessmentAtomic) return NextResponse.json({ error: `The budget cannot exceed ${Number(l.maxAssessmentAtomic) / 1e6} USDC.` }, { status: 400 });
  if (hasActiveRun() || hasActiveBatch()) return NextResponse.json({ error: "Another assessment is running. Try again when it finishes." }, { status: 409 });
  if (lifetimeSpendAtomic(createStore()) + requested > l.maxTotalAtomic) return NextResponse.json({ error: "This deployment has reached its total spending limit." }, { status: 403 });

  return NextResponse.json({ run_id: startRun(parsed.data.token, requested, chain).runId }, { status: 202 });
}
