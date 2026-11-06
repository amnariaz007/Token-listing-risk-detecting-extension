import { createStore } from "@/lib/storage/assessments.ts";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = createStore().load(id);
  if (!record) return new Response("Not found", { status: 404 });
  return new Response(JSON.stringify(record.bundle, null, 2), { headers: { "content-type": "application/json", "content-disposition": `attachment; filename="${id}-evidence.json"` } });
}
