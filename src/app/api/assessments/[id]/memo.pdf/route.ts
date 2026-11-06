import { renderPdf } from "@/lib/memo/pdf.ts";
import { createStore } from "@/lib/storage/assessments.ts";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = createStore().load(id);
  if (!record) return new Response("Not found", { status: 404 });
  const pdf = await renderPdf(record.bundle);
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${id}.pdf"` } });
}
