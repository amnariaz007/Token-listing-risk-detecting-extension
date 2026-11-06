import { NextResponse, type NextRequest } from "next/server";
import { limits } from "@/config/protocol.ts";
import { hasActiveBatch, parseBatchInput, startBatch } from "@/lib/agent/batch.ts";
import { guardSpending } from "@/lib/agent/guard.ts";
import { InputError } from "@/lib/agent/input.ts";
import { hasActiveRun, lifetimeSpendAtomic } from "@/lib/agent/runtime.ts";
import { MissingWalletError, paymentAccount } from "@/lib/blockchain/wallet.ts";
import { createStore } from "@/lib/storage/assessments.ts";

export async function POST(req: NextRequest) {
  const refused = guardSpending(req);
  if (refused) return refused;
  try {
    paymentAccount();
    const body = (await req.json().catch(() => null)) as { tokens?: unknown } | null;
    const items = parseBatchInput(body?.tokens);
    if (hasActiveRun() || hasActiveBatch()) return NextResponse.json({ error: "Another assessment is running. Try again when it finishes." }, { status: 409 });
    const l = limits();
    if (lifetimeSpendAtomic(createStore()) + l.maxBatchAtomic > l.maxTotalAtomic) return NextResponse.json({ error: "This deployment has reached its total spending limit." }, { status: 403 });
    return NextResponse.json({ batch_id: startBatch(items).id }, { status: 202 });
  } catch (err) {
    if (err instanceof InputError) return NextResponse.json({ error: err.message }, { status: 400 });
    if (err instanceof MissingWalletError) return NextResponse.json({ error: err.message }, { status: 503 });
    throw err;
  }
}
