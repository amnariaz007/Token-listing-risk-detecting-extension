import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "Token Listing Risk", description: "Autonomous listing-risk memos built on purchased Telegraph intelligence." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <header className="border-b border-line bg-panel">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3">
            <nav className="flex items-center gap-5 text-sm">
              <Link href="/" className="font-semibold">Token Listing Risk</Link>
              <Link href="/" className="text-muted hover:text-ink">Dashboard</Link>
              <Link href="/assessments/new" className="text-muted hover:text-ink">New assessment</Link>
              <Link href="/batches/new" className="text-muted hover:text-ink">Watchlist</Link>
            </nav>
            <span className="rounded border border-caution/50 px-2 py-0.5 text-xs font-semibold text-caution">TESTNET: Ethereum Sepolia</span>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
