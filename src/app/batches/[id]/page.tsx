"use client";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import type { Batch } from "@/lib/agent/batch.ts";
import { Card, PageHeader, State, Table, Verdict } from "@/components/ui.tsx";

export default function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/batches/${id}`);
        if (!res.ok) throw new Error("This batch was not found.");
        const next = (await res.json()) as Batch;
        setBatch(next);
        if (!next.done && !stop) setTimeout(tick, 3000);
      } catch (err) {
        setError((err as Error).message);
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }, [id]);

  const total = batch ? batch.rows.reduce((sum, r) => sum + BigInt(r.cost_atomic), 0n) : 0n;
  return (
    <>
      <PageHeader title="Watchlist risk ranking" subtitle={batch ? `${batch.done ? "Finished" : "Running"}. Riskiest first. Total paid: ${Number(total) / 1e6} test USDC.` : "Loading"} />
      {error && <p role="alert" className="mb-4 text-sm text-high">{error}</p>}
      <Card>
        <Table
          head={["Token", "Chain", "Verdict", "Confidence", "Top reason", "Cost", "Memo"]}
          rows={(batch?.rows ?? []).map((r) => [
            <span key="t"><span className="font-medium">{r.symbol ?? ""}</span> <span className="block font-mono text-xs break-all text-muted">{r.token}</span></span>,
            r.chain,
            r.verdict ? <Verdict key="v" verdict={r.verdict} /> : <State key="s" value={r.status} />,
            r.confidence ?? "",
            r.top_reason ?? "",
            r.cost ?? "",
            r.memo_id ? <Link key="m" href={`/assessments/${r.memo_id}/memo`} className="font-mono text-xs text-accent hover:underline">{r.memo_id}</Link> : "",
          ])}
        />
      </Card>
    </>
  );
}
