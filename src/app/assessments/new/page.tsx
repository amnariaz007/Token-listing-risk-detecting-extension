"use client";
import { Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Card, PageHeader, primaryButton } from "@/components/ui.tsx";

const input = "w-full rounded-md border border-line bg-bg px-3 py-2 text-sm";

export default function NewAssessment() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const res = await fetch("/api/assessments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: form.get("token"), chain: form.get("chain"), budget_usdc: Number(form.get("budget")) }),
      });
      const body = (await res.json()) as { run_id?: string; error?: string };
      if (!res.ok || !body.run_id) throw new Error(body.error ?? "The assessment could not start.");
      router.push(`/runs/${body.run_id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="New assessment" subtitle="Enter a token. The agent chooses, buys and verifies the intelligence by itself." />
      <Card className="max-w-xl">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label htmlFor="token" className="mb-1 block text-sm font-medium">Contract address or token symbol</label>
            <input id="token" name="token" required autoComplete="off" placeholder="0x... or USDC" className={input} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="budget" className="mb-1 block text-sm font-medium">Budget (test USDC)</label>
              <input id="budget" name="budget" type="number" step="0.001" min="0.001" max="0.07" defaultValue="0.07" className={input} />
            </div>
            <div>
              <label htmlFor="chain" className="mb-1 block text-sm font-medium">Token's chain</label>
              <select id="chain" name="chain" defaultValue="ethereum" className={input}>
                <option value="ethereum">Ethereum</option>
                <option value="base">Base</option>
                <option value="arbitrum">Arbitrum</option>
                <option value="optimism">Optimism</option>
                <option value="polygon">Polygon</option>
                <option value="ethereum-sepolia">Ethereum Sepolia</option>
              </select>
            </div>
          </div>
          <p className="text-xs text-muted">Payments are always test USDC on Sepolia, up to the budget, whichever chain the token is on. Use a contract address for the forensic checks: a symbol can be shared by several tokens, so most of them cannot run on one.</p>
          {error && <p role="alert" className="text-sm text-high">{error}</p>}
          <button type="submit" disabled={busy} className={primaryButton}><Play size={16} /> {busy ? "Starting..." : "Start assessment"}</button>
        </form>
      </Card>
    </>
  );
}
