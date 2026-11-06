import { NextResponse } from "next/server";
import { getRun } from "@/lib/agent/runtime.ts";

/** Plain polling for clients that cannot hold an event stream open, such as the browser extension. */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const run = getRun((await params).runId);
  if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
  return NextResponse.json({ done: run.done, memo_id: run.memoId, error: run.error, latest: run.events.at(-1)?.message ?? null, events: run.events.length });
}
