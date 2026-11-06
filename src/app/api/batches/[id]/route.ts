import { NextResponse } from "next/server";
import { getBatch } from "@/lib/agent/batch.ts";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const batch = getBatch((await params).id);
  return batch ? NextResponse.json(batch) : NextResponse.json({ error: "Not found" }, { status: 404 });
}
