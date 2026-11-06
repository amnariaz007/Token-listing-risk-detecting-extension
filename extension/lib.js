// Pure page parsing and display helpers, shared by the content script and the tests. No network or DOM writes.
(() => {
  const EXPLORERS = {
    "etherscan.io": "ethereum",
    "sepolia.etherscan.io": "ethereum-sepolia",
    "basescan.org": "base",
    "arbiscan.io": "arbitrum",
    "optimistic.etherscan.io": "optimism",
    "polygonscan.com": "polygon",
  };
  const DEXSCREENER_CHAINS = ["ethereum", "base", "arbitrum", "optimism", "polygon"];
  const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

  /** Works out what is on the page from its URL. A DEXScreener URL names a pair, which the background script resolves to its token. */
  function parseTokenPage(href) {
    let url;
    try {
      url = new URL(href);
    } catch {
      return null;
    }
    const host = url.hostname.replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    if (host in EXPLORERS) {
      if (parts[0] !== "token" || !ADDRESS.test(parts[1] ?? "")) return null;
      return { kind: "token", address: parts[1], chain: EXPLORERS[host] };
    }
    if (host === "dexscreener.com") {
      if (!DEXSCREENER_CHAINS.includes(parts[0]) || !ADDRESS.test(parts[1] ?? "")) return null;
      return { kind: "pair", pair: parts[1], chain: parts[0] };
    }
    return null;
  }

  /** The token a DexScreener pair response describes, or null. */
  function tokenFromPair(response, chain) {
    const pair = (response?.pairs ?? [])[0];
    const address = pair?.baseToken?.address;
    return ADDRESS.test(address ?? "") && pair.chainId === chain ? { kind: "token", address, chain } : null;
  }

  /** The fields the panel shows, read from the signed memo. The panel holds no report logic of its own. */
  function panelModel(view, baseUrl) {
    const { memo, memo_hash: memoHash, signer_address: signer } = view.signed;
    return {
      verdict: memo.verdict,
      confidence: memo.confidence,
      coverage: `${memo.coverage.executed} of ${memo.coverage.planned} planned checks`,
      reason: memo.verdict_reason,
      rows: memo.checks.map((c) => ({
        name: c.name,
        finding: c.finding ?? c.failure_reason ?? "",
        status: c.status,
        tier: c.tier === undefined ? "" : `T${c.tier}`,
        cost: c.payment?.status === "confirmed" ? `${c.payment.amount} ${c.payment.currency}` : "None",
      })),
      skipped: memo.checks_skipped.map((s) => `${s.name}: ${s.reason}`),
      total: memo.cost.totals.map((t) => `${t.amount} ${t.currency}`).join(" + ") || "0",
      verified: view.verification.valid,
      memoHash,
      signer,
      memoUrl: `${baseUrl}/assessments/${view.id}/memo`,
      evidenceUrl: `${baseUrl}/assessments/${view.id}/evidence`,
    };
  }

  globalThis.ListingRisk = { parseTokenPage, tokenFromPair, panelModel };
})();
