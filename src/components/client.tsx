"use client";
import { Check, Copy, ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`${label}: ${value}`}
      className="inline-flex shrink-0 items-center gap-1 rounded border border-line px-2 py-0.5 text-xs text-muted hover:border-accent hover:text-ink"
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

export function HashRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1 text-sm">
      <span className="w-40 shrink-0 text-muted">{label}</span>
      <code className="min-w-0 flex-1 break-all font-mono text-xs">{value ?? "unavailable"}</code>
      {value && <CopyButton value={value} label={`Copy ${label}`} />}
    </div>
  );
}

export function JsonBlock({ title, value, open = false }: { title: string; value: unknown; open?: boolean }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return (
    <details open={open} className="rounded-md border border-line bg-bg">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium">{title}</summary>
      <pre className="max-h-96 overflow-auto border-t border-line p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-all">{text ?? "Not provided by the protocol"}</pre>
    </details>
  );
}

type Result = { valid: boolean; memo_hash: string | null; recovered_signer: string | null; errors: string[] };

export function VerifyButton({ id, initial }: { id: string; initial: Result }) {
  const [result, setResult] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  return (
    <div>
      <div className={`flex items-center gap-2 text-sm font-medium ${result.valid ? "text-clear" : "text-high"}`}>
        {result.valid ? <ShieldCheck size={16} /> : <ShieldX size={16} />}
        {result.valid ? "Signature and evidence verified" : "Verification failed"}
      </div>
      {result.errors.map((e) => <p key={e} className="mt-1 text-xs text-high">{e}</p>)}
      <button
        type="button"
        disabled={busy}
        className="mt-3 rounded-md border border-line bg-panel-2 px-3 py-1.5 text-xs hover:border-accent disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          try {
            setResult(await (await fetch(`/api/assessments/${id}/verify`)).json());
            setCheckedAt(new Date().toLocaleTimeString());
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Verifying..." : "Verify again"}
      </button>
      {checkedAt && <span className="ml-2 text-xs text-muted">Checked at {checkedAt}</span>}
    </div>
  );
}
