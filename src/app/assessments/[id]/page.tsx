import { FileText, Search } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { buildView } from "@/lib/agent/view.ts";
import { formatUsd } from "@/lib/memo/render.ts";
import { TIER_MEANINGS } from "@/lib/memo/schema.ts";
import { createStore } from "@/lib/storage/assessments.ts";
import { Card, PageHeader, State, Table, Verdict, linkButton } from "@/components/ui.tsx";
import { HashRow, VerifyButton } from "@/components/client.tsx";

export const dynamic = "force-dynamic";

export default async function Results({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = createStore().load(id);
  if (!record) notFound();
  const view = await buildView(record);
  const { memo } = view.signed;
  const observations = memo.checks.flatMap((c) => c.signals.filter((s) => s.level !== "clear" && s.level !== "superseded").map((s) => ({ check: c.name, ...s })));
  const noPurchases = memo.cost.checks_paid === 0;

  return (
    <>
      <PageHeader
        title={`${memo.token.name ? `${memo.token.name} / ` : ""}${memo.token.symbol}`}
        subtitle={<span className="font-mono text-xs">{id}, generated {memo.generated_at}</span>}
        action={
          <div className="flex gap-2">
            <Link href={`/assessments/${id}/evidence`} className={linkButton}><Search size={14} /> Evidence</Link>
            <Link href={`/assessments/${id}/memo`} className={linkButton}><FileText size={14} /> Memo</Link>
          </div>
        }
      />
      {noPurchases && (
        <div role="alert" className="mb-4 rounded-lg border border-high/50 bg-panel p-4 text-sm text-high">
          No intelligence was purchased in this run, so this is not an assessment of the token. The reasons are listed below.
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Verdict">
          <Verdict verdict={memo.verdict} className="text-2xl" />
          <p className="mt-2 text-sm text-muted">{memo.verdict_reason}</p>
        </Card>
        <Card title="Reliability">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Confidence</dt><dd>{memo.confidence}</dd>
            <dt className="text-muted">Evidence coverage</dt><dd>{memo.coverage.executed} of {memo.coverage.planned} checks</dd>
            <dt className="text-muted">Duration</dt><dd>{(view.summary.duration_ms / 1000).toFixed(1)}s</dd>
          </dl>
        </Card>
        <Card title="Signature">
          <VerifyButton id={id} initial={view.verification} />
        </Card>
      </div>
      <Card title="Token" className="mt-4">
        {memo.token.address ? <HashRow label="Contract address" value={memo.token.address} /> : <p className="py-1 text-sm text-muted">The contract address was not resolved, because the input was a symbol.</p>}
        <dl className="mt-1 grid grid-cols-[160px_1fr] gap-y-1 text-sm">
          <dt className="text-muted">Chain</dt><dd>{memo.token.chain}</dd>
          <dt className="text-muted">Identity source</dt><dd>{memo.token.identity_source === "onchain" ? "Read from the contract" : "As entered by the user"}</dd>
          <dt className="text-muted">Payments on</dt><dd>{memo.payment_network} ({memo.network})</dd>
        </dl>
      </Card>
      <Card title="Intelligence sources" className="mt-4">
        <Table
          head={["Check", "Intent", "Miner", "Finding", "Status", "Tier", "Cost"]}
          align={["left", "left", "left", "left", "left", "left", "right"]}
          rows={memo.checks.map((c) => [
            c.name,
            <span key="i" className="font-mono text-xs break-all">{c.intent}</span>,
            c.miner_id ?? "",
            c.finding ?? c.failure_reason ?? "",
            <State key="s" value={c.status} />,
            c.tier ? <span key="t" title={TIER_MEANINGS[c.tier]}>T{c.tier}</span> : "",
            c.cost_usd !== null ? `${formatUsd(c.cost_usd)} ${c.payment?.currency}` : "No confirmed charge",
          ])}
        />
        {memo.checks_skipped.map((s) => <p key={s.name} className="mt-2 text-sm text-muted">Skipped: {s.name}. {s.reason}</p>)}
        <p className="mt-3 text-xs text-muted">Tiers: {Object.entries(TIER_MEANINGS).map(([k, v]) => `T${k} ${v.toLowerCase()}`).join(". ")}.</p>
      </Card>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title="Risk observations">
          {observations.length === 0 ? <p className="text-sm text-muted">{noPurchases ? "None, because no evidence was purchased." : "No negative or inconclusive signals from executed checks. Skipped checks are not counted as clean."}</p> : (
            <ul className="space-y-2 text-sm">
              {observations.map((o) => (
                <li key={`${o.check}${o.code}`}>
                  <span className="font-medium">{o.check}:</span> {o.explanation}{" "}
                  <span className="text-xs text-muted">({o.level}, {o.basis === "inference" ? "application inference" : "miner reported"})</span>
                  {o.details && <ul className="mt-1 list-disc pl-5 text-xs text-muted">{o.details.map((d) => <li key={d}>{d}</li>)}</ul>}
                </li>
              ))}
            </ul>
          )}
          {memo.limitations.length > 0 && <h3 className="mt-4 text-xs font-semibold text-muted">Limitations</h3>}
          {memo.limitations.map((l) => <p key={l} className="mt-1 text-sm text-muted">{l}</p>)}
        </Card>
        <Card title="Cost breakdown">
          <Table
            head={["Request", "Confirmed cost"]}
            align={["left", "right"]}
            rows={[
              ...memo.cost.line_items.map((l) => [l.check, `${l.amount} ${l.currency}`]),
              [<strong key="t">Total paid</strong>, <strong key="v">{memo.cost.totals.map((t) => `${t.amount} ${t.currency}`).join(" + ") || "0"}</strong>],
            ]}
          />
          {memo.cost.failed_attempts > 0 && <p className="mt-2 text-xs text-muted">{memo.cost.failed_attempts} attempt(s) failed or stayed unconfirmed, and are not in this total.</p>}
        </Card>
      </div>
    </>
  );
}
