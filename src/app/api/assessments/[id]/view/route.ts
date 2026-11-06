import { NextResponse } from "next/server";
import { buildView } from "@/lib/agent/view.ts";
import { createStore } from "@/lib/storage/assessments.ts";

/** A stored memo with its text and verification, for thin clients. It holds no report logic of its own. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const record = createStore().load((await params).id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { signed, memo_text, verification, id } = await buildView(record);
  return NextResponse.json({ id, signed, memo_text, verification });
}
