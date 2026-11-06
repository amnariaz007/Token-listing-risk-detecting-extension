import Link from "next/link";
import { notFound } from "next/navigation";
import { buildView } from "@/lib/agent/view.ts";
import { createStore } from "@/lib/storage/assessments.ts";
import { Card, PageHeader, State, linkButton } from "@/components/ui.tsx";
import { HashRow, JsonBlock } from "@/components/client.tsx";

export const dynamic = "force-dynamic";

export default async function Evidence({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const store = createStore();
  const record = store.load(id);
  if (!record) notFound();
  const view = await buildView(record);
  const { memo } = view.signed;

  return (
    <>
      <PageHeader
        title="Evidence explorer"
        subtitle={<span className="font-mono text-xs">{id}</span>}
        action={<a href={`/api/assessments/${id}/bundle.json`} className={linkButton}>Download JSON evidence</a>}
      />
      <div className="space-y-4">
        {memo.checks.map((check) => {
          const raw = view.evidence.find((e) => e.check === check.name);
          return (
            <Card key={check.name} title={check.name} action={<State value={check.status} />}>
              <p className="mb-2 font-mono text-xs text-muted break-all">{check.intent}, miner {check.miner_id ?? "not reported"}</p>
              {check.failure_reason && <p className="mb-2 text-sm text-high">{check.failure_reason}</p>}
              <HashRow label="Receipt hash" value={check.receipt_reference} />
              <HashRow label="Settlement transaction" value={check.payment?.tx_hash} />
              <HashRow label="Signal hash" value={check.signal_hash} />
              <div className="flex flex-wrap gap-x-3 py-1 text-sm">
                <span className="w-40 shrink-0 text-muted">Signal re-derived</span>
                <span>{check.signal_verified === null ? "Not checked" : check.signal_verified ? "Yes, the hash matches its payload" : "No, the hash does not match"}</span>
              </div>
              {check.payment?.tx_hash && (
                <a href={`https://sepolia.etherscan.io/tx/${check.payment.tx_hash}`} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">View settlement on Sepolia Etherscan</a>
              )}
              {raw && (
                <div className="mt-3 space-y-2">
                  <JsonBlock title="Original request" value={{ method: raw.method, url: raw.url, body: raw.request_body, requested_at: raw.requested_at, responded_at: raw.responded_at, duration_ms: raw.duration_ms }} />
                  <JsonBlock title="HTTP exchanges, including the 402" value={raw.exchanges} />
                  <JsonBlock title="Payment requirements" value={raw.challenge} />
                  <JsonBlock title="Confirmed payment" value={check.payment} />
                  <JsonBlock title="Settlement proof (PAYMENT-RESPONSE)" value={raw.settlement} />
                  <JsonBlock title="Telegraph receipt (X-TELEGRAPH-RECEIPT)" value={raw.receipt} />
                  <JsonBlock title="Miner response" value={raw.response} open />
                  <JsonBlock title="Stored signal" value={raw.signal} />
                </div>
              )}
            </Card>
          );
        })}
        {memo.checks_skipped.map((s) => (
          <Card key={s.name} title={s.name} action={<State value="skipped" />}><p className="text-sm text-muted">{s.reason} No request or payment was made.</p></Card>
        ))}
        <Card title="Agent decisions">
          <div className="space-y-2">
            <JsonBlock title="Plan" value={store.plan(id)} />
            <JsonBlock title="Capability snapshot" value={store.capabilities(id)} />
            <JsonBlock title="Execution log" value={store.events(id)} />
          </div>
        </Card>
      </div>
      <Link href={`/assessments/${id}`} className="mt-4 inline-block text-sm text-accent hover:underline">Back to results</Link>
    </>
  );
}
