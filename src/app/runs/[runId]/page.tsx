"use client";
import { Check, Circle, Loader2, X } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";
import type { AgentEvent, Step } from "@/lib/agent/orchestrator.ts";
import { Card, PageHeader, State, Table, linkButton, primaryButton } from "@/components/ui.tsx";

const STEPS: { key: Step; label: string }[] = [
  { key: "validate", label: "Validating token input" },
  { key: "discover", label: "Discovering live intelligence capabilities" },
  { key: "plan", label: "Planning intelligence purchases" },
  { key: "prepare", label: "Preparing Telegraph requests" },
  { key: "challenge", label: "Receiving HTTP 402 payment requirements" },
  { key: "pay", label: "Executing x402 payments" },
  { key: "receive", label: "Receiving miner responses" },
  { key: "evidence", label: "Verifying and storing evidence" },
  { key: "risk", label: "Evaluating risk" },
  { key: "sign", label: "Generating the signed memo" },
];

type Row = { name: string; intent: string; miner_id?: string | null; state?: string; quoted?: string | null; cost?: string | null; duration_ms?: number | null };

export default function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = use(params);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [finish, setFinish] = useState<{ memo_id: string | null; error: string | null } | null>(null);
  const [lost, setLost] = useState(false);

  useEffect(() => {
    const source = new EventSource(`/api/runs/${runId}/events`);
    source.onmessage = (m) => setEvents((prev) => [...prev, JSON.parse(m.data) as AgentEvent]);
    source.addEventListener("finish", (m) => {
      setFinish(JSON.parse((m as MessageEvent).data));
      source.close();
    });
    source.onerror = () => {
      source.close();
      setLost(true);
    };
    return () => source.close();
  }, [runId]);

  const rows = useMemo(() => {
    const byName = new Map<string, Row>();
    for (const e of events) if (e.check) byName.set(e.check.name, { ...byName.get(e.check.name), ...Object.fromEntries(Object.entries(e.check).filter(([, v]) => v !== undefined && v !== null)) } as Row);
    return [...byName.values()];
  }, [events]);

  const stepState = (key: Step) => {
    const mine = events.filter((e) => e.step === key);
    if (mine.length === 0) return "pending";
    if (mine.some((e) => e.status === "failed")) return "failed";
    if (mine.some((e) => e.status === "done") || finish) return "done";
    return "running";
  };

  return (
    <>
      <PageHeader
        title="Agent execution"
        subtitle="Each line is a real event from the running agent."
        action={finish?.memo_id && <Link href={`/assessments/${finish.memo_id}`} className={primaryButton}>View results</Link>}
      />
      {finish?.error && (
        <div role="alert" className="mb-4 rounded-lg border border-high/50 bg-panel p-4 text-sm">
          <p className="text-high">{finish.error}</p>
          <Link href="/assessments/new" className={`${linkButton} mt-3`}>Try another token</Link>
        </div>
      )}
      {lost && !finish && <p role="alert" className="mb-4 text-sm text-caution">The live connection dropped. The run may still finish, so check the dashboard.</p>}
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Card title="Lifecycle">
          <ol className="space-y-2 text-sm">
            {STEPS.map(({ key, label }) => {
              const s = stepState(key);
              return (
                <li key={key} className="flex items-start gap-2">
                  <span className="mt-0.5">
                    {s === "done" && <Check size={14} className="text-clear" />}
                    {s === "failed" && <X size={14} className="text-high" />}
                    {s === "running" && <Loader2 size={14} className="animate-spin text-accent" />}
                    {s === "pending" && <Circle size={14} className="text-line" />}
                  </span>
                  <span className={s === "pending" ? "text-muted" : ""}>{label}</span>
                </li>
              );
            })}
          </ol>
        </Card>
        <div className="space-y-4">
          <Card title="Intelligence requests">
            {rows.length === 0 ? <p className="text-sm text-muted">Waiting for the plan.</p> : (
              <Table
                head={["Check", "Intent", "Miner", "Status", "Quoted", "Confirmed", "Duration"]}
                rows={rows.map((r) => [
                  r.name,
                  <span key="i" className="font-mono text-xs break-all">{r.intent}</span>,
                  r.miner_id ?? "Routed by network",
                  <State key="s" value={r.state ?? "pending"} />,
                  r.quoted ?? "",
                  r.cost ?? "None",
                  r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "",
                ])}
              />
            )}
          </Card>
          <Card title="Execution log">
            <ul aria-live="polite" className="max-h-96 space-y-1 overflow-auto font-mono text-xs">
              {events.map((e, i) => (
                <li key={i} className={e.status === "failed" ? "text-high" : "text-muted"}>
                  <span className="mr-2 opacity-60">{e.at.slice(11, 19)}</span>{e.message}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
