import { Download } from "lucide-react";
import { notFound } from "next/navigation";
import { buildView } from "@/lib/agent/view.ts";
import { createStore } from "@/lib/storage/assessments.ts";
import { Card, PageHeader, linkButton } from "@/components/ui.tsx";
import { HashRow, VerifyButton } from "@/components/client.tsx";

export const dynamic = "force-dynamic";

export default async function MemoViewer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = createStore().load(id);
  if (!record) notFound();
  const view = await buildView(record);
  const { signed } = view;

  return (
    <>
      <PageHeader
        title="Listing-risk memo"
        subtitle={<span className="font-mono text-xs">{id}</span>}
        action={
          <div className="flex flex-wrap gap-2">
            <a href={`/api/assessments/${id}/memo.pdf`} className={linkButton}><Download size={14} /> PDF</a>
            <a href={`/api/assessments/${id}/bundle.json`} className={linkButton}><Download size={14} /> JSON evidence</a>
          </div>
        }
      />
      <div className="overflow-x-auto rounded-lg bg-white p-6 text-neutral-900">
        <pre tabIndex={0} className="mx-auto w-fit font-mono text-[13px] leading-snug">{view.memo_text}</pre>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_280px]">
        <Card title="Application signature">
          <HashRow label="Memo hash (SHA-256)" value={signed.memo_hash} />
          <HashRow label="Signer" value={signed.signer_address} />
          <HashRow label="Signature" value={signed.signature} />
          <p className="mt-2 text-xs text-muted">Signed {signed.memo.signed_at} using scheme {signed.scheme}. This is the application's signature. It is not a Telegraph receipt or a miner signature.</p>
        </Card>
        <Card title="Verification"><VerifyButton id={id} initial={view.verification} /></Card>
      </div>
      <details className="mt-4 rounded-lg border border-line bg-panel p-4">
        <summary className="cursor-pointer text-sm font-semibold">Appendix: raw receipts</summary>
        <pre tabIndex={0} className="mt-3 overflow-x-auto font-mono text-xs leading-relaxed">{view.appendix_text}</pre>
      </details>
    </>
  );
}
