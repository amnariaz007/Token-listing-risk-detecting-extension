import Link from "next/link";
import { Plus } from "lucide-react";
import { MissingWalletError, walletStatus, type WalletStatus } from "@/lib/blockchain/wallet.ts";
import { createStore } from "@/lib/storage/assessments.ts";
import { fetchNetworkStatus } from "@/lib/telegraph/discovery.ts";
import { Card, PageHeader, Stat, Table, Verdict, primaryButton } from "@/components/ui.tsx";

export const dynamic = "force-dynamic";

async function readWallet(): Promise<{ wallet: WalletStatus | null; note: string | null }> {
  try {
    return { wallet: await walletStatus(), note: null };
  } catch (err) {
    return { wallet: null, note: err instanceof MissingWalletError ? err.message : "Wallet balance could not be read." };
  }
}

export default async function Dashboard() {
  const records = createStore().list();
  const [network, { wallet, note }] = await Promise.all([fetchNetworkStatus(), readWallet()]);
  const memos = records.map((r) => r.bundle.signed.memo);
  const purchases = memos.reduce((n, m) => n + m.cost.checks_paid, 0);
  const spent = memos.reduce((n, m) => n + m.cost.totals.reduce((s, t) => s + BigInt(t.amount_atomic), 0n), 0n);
  const avg = records.length ? records.reduce((n, r) => n + r.summary.duration_ms, 0) / records.length / 1000 : null;

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="All figures come from this application's stored assessment records."
        action={<Link href="/assessments/new" className={primaryButton}><Plus size={16} /> New assessment</Link>}
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total assessments" value={records.length} />
        <Stat label="Verified purchases" value={purchases} />
        <Stat label="Test USDC spent" value={(Number(spent) / 1e6).toFixed(2)} />
        <Stat label="Average duration" value={avg === null ? "None yet" : `${avg.toFixed(1)}s`} />
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title="Telegraph network">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Node</dt>
            <dd className={network.online ? "text-clear" : "text-high"}>{network.online ? "Online" : `Unavailable: ${network.error}`}</dd>
            <dt className="text-muted">Live intents</dt><dd>{network.intents ?? "Unknown"}</dd>
            <dt className="text-muted">Intents with miners</dt><dd>{network.intents_with_miners ?? "Unknown"}</dd>
            <dt className="text-muted">Epoch</dt><dd>{network.epoch ?? "Unknown"}</dd>
            <dt className="text-muted">Environment</dt><dd>Ethereum Sepolia testnet</dd>
          </dl>
        </Card>
        <Card title="Burner wallet">
          {wallet ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Address</dt><dd className="break-all font-mono text-xs">{wallet.address}</dd>
              <dt className="text-muted">Test USDC</dt><dd>{wallet.usdc}</dd>
              <dt className="text-muted">Sepolia ETH</dt><dd>{wallet.eth}</dd>
            </dl>
          ) : <p className="text-sm text-caution">{note}</p>}
          {wallet && Number(wallet.usdc) < 0.05 && <p className="mt-3 text-xs text-caution">Not enough test USDC for an assessment. See docs/SETUP.md.</p>}
        </Card>
      </div>
      <Card title="Recent assessments" className="mt-4">
        {records.length === 0 ? (
          <p className="text-sm text-muted">No assessments yet. Start one to see it here.</p>
        ) : (
          <Table
            head={["Memo", "Token", "Verdict", "Confidence", "Coverage", "Paid", "Generated"]}
            rows={records.slice(0, 20).map(({ id, bundle: { signed: { memo } } }) => [
              <Link key={id} href={`/assessments/${id}`} className="font-mono text-xs text-accent hover:underline">{id}</Link>,
              memo.token.symbol,
              <Verdict key="v" verdict={memo.verdict} />,
              memo.confidence,
              `${memo.coverage.executed} of ${memo.coverage.planned}`,
              memo.cost.totals.map((t) => `${t.amount} ${t.currency}`).join(" + ") || "0",
              memo.generated_at.replace("T", " ").replace("Z", " UTC"),
            ])}
          />
        )}
      </Card>
    </>
  );
}
