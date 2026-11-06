"use client";
import { ListChecks } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Card, PageHeader, primaryButton } from "@/components/ui.tsx";

export default function NewBatch() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const text = String(new FormData(event.currentTarget).get("tokens"));
    const tokens = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
      const [token, chain] = l.split(/[\s,]+/);
      return { token, chain: chain || "ethereum" };
    });
    try {
      const res = await fetch("/api/batches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tokens }) });
      const body = (await res.json()) as { batch_id?: string; error?: string };
      if (!res.ok || !body.batch_id) throw new Error(body.error ?? "The batch could not start.");
      router.push(`/batches/${body.batch_id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Watchlist batch" subtitle="Assess 2 to 10 tokens in one run and rank them by risk." />
      <Card className="max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="tokens" className="mb-1 block text-sm font-medium">Tokens, one per line</label>
            <textarea id="tokens" name="tokens" required rows={8} spellCheck={false} placeholder={"0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984 ethereum\n0x6982508145454Ce325dDbE47a25d4ec3d2311933 ethereum\nBTC"} className="w-full rounded-md border border-line bg-bg px-3 py-2 font-mono text-xs" />
            <p className="mt-1 text-xs text-muted">Write an address or symbol, then optionally a chain: ethereum, base, arbitrum, optimism, polygon or ethereum-sepolia.</p>
          </div>
          <p className="text-xs text-muted">This spends test USDC from the burner wallet, up to about 0.07 per token and 0.70 in total. Payments stay on Sepolia.</p>
          {error && <p role="alert" className="text-sm text-high">{error}</p>}
          <button type="submit" disabled={busy} className={primaryButton}><ListChecks size={16} /> {busy ? "Starting..." : "Start batch"}</button>
        </form>
      </Card>
    </>
  );
}
