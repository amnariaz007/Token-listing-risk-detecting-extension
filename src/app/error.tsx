"use client";
export default function ErrorPage({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="rounded-lg border border-high/50 bg-panel p-6">
      <h1 className="font-semibold">This page could not load</h1>
      <p className="mt-2 text-sm text-muted">{error.message}</p>
      <button type="button" onClick={reset} className="mt-4 rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent">Try again</button>
    </div>
  );
}
