import { NextResponse } from "next/server";
import { verifyBundle } from "@/lib/memo/verify.ts";
import { createStore } from "@/lib/storage/assessments.ts";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const record = createStore().load((await params).id);
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(await verifyBundle(record.bundle));
}
