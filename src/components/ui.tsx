import clsx from "clsx";
import type { ReactNode } from "react";

export function Card({ title, children, className, action }: { title?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return (
    <section className={clsx("rounded-lg border border-line bg-panel p-5", className)}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {note && <div className="mt-1 text-xs text-muted">{note}</div>}
    </div>
  );
}

export const verdictColor = (verdict: string) => (verdict === "CLEAR" ? "text-clear" : verdict === "HIGH RISK" ? "text-high" : "text-caution");

export function Verdict({ verdict, className }: { verdict: string; className?: string }) {
  return <span className={clsx("font-semibold", verdictColor(verdict), className)}>{verdict}</span>;
}

const STATE_COLORS: Record<string, string> = {
  ok: "text-clear", done: "text-clear", verified: "text-clear",
  failed: "text-high", unconfirmed: "text-caution", skipped: "text-muted",
};
export function State({ value }: { value: string }) {
  return <span className={clsx("text-xs font-medium", STATE_COLORS[value] ?? "text-accent")}>{value}</span>;
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export const linkButton = "inline-flex items-center gap-2 rounded-md border border-line bg-panel-2 px-3 py-2 text-sm hover:border-accent";
export const primaryButton = "inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-bg hover:opacity-90 disabled:opacity-50";

export function Table({ head, rows, align }: { head: string[]; rows: ReactNode[][]; align?: ("left" | "right")[] }) {
  const cls = (i: number) => (align?.[i] === "right" ? "text-right" : "text-left");
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            {head.map((h, i) => <th key={h} className={clsx("px-2 py-2 font-medium", cls(i))}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-b border-line/50 last:border-0">
              {row.map((cell, i) => <td key={i} className={clsx("px-2 py-2 align-top", cls(i))}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
