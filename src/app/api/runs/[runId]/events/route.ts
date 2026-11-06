import { getRun } from "@/lib/agent/runtime.ts";
import type { AgentEvent } from "@/lib/agent/orchestrator.ts";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const run = getRun(runId);
  if (!run) return new Response("Run not found", { status: 404 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (text: string) => controller.enqueue(encoder.encode(text));
      const finish = () => {
        send(`event: finish\ndata: ${JSON.stringify({ memo_id: run.memoId, error: run.error })}\n\n`);
        controller.close();
      };
      for (const e of run.events) send(`data: ${JSON.stringify(e)}\n\n`);
      if (run.done) return finish();
      const listener = (e: AgentEvent | null) => {
        if (e) send(`data: ${JSON.stringify(e)}\n\n`);
        else {
          run.listeners.delete(listener);
          finish();
        }
      };
      run.listeners.add(listener);
      req.signal.addEventListener("abort", () => run.listeners.delete(listener));
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
