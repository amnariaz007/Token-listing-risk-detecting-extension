# Architecture

## Flow

```
Token input
  -> resolve identity (Sepolia contract read, or symbol as entered)
  -> discover live intents, schemas and miners
  -> find the largest DEX pool (free lookup)
  -> plan up to 6 checks, forensic ones first, priced by free unpaid 402 requests
  -> buy each one over x402 (limited concurrency, budget reserved before signing)
  -> confirm: Telegraph receipt + on-chain transfer + signal hash re-derived
  -> if a miner gave no usable answer, buy one second source while budget remains
  -> deterministic verdict and confidence
  -> canonical memo -> sign -> store
```

## Layout

| Path | Responsibility |
|---|---|
| `src/config/protocol.ts` | Documented addresses, network and safety limits |
| `src/lib/telegraph/` | Discovery, the paid client, 402 validation and budget, signal verification |
| `src/lib/agent/` | Input, planner, executor, parsers, orchestrator, runtime |
| `src/lib/blockchain/` | Wallet and on-chain settlement verification |
| `src/lib/memo/` | Canonical schema, verdict, cost, renderers, PDF, signing |
| `src/lib/storage/` | Append-only files in `data/assessments/{id}/` |
| `src/app/` | Next.js pages and API routes. Business logic stays out of the UI |
| `extension/` | Thin Manifest V3 browser client |

## Single source of truth

`assembleMemo` creates the only memo object. The rendered memo, appendix, PDF, signature and API all read from it, and the PDF prints the same text the app shows. Validation recomputes the verdict, confidence and costs from the evidence, so an altered memo fails verification.

## When a purchase counts as paid

All of these must hold:

1. The 402 terms name Sepolia, the documented test USDC and the Diamond, and fit the limits.
2. The response is a 2xx with an `X-TELEGRAPH-RECEIPT`.
3. The settlement transaction succeeded and holds an unclaimed transfer of the receipt's amount, from this wallet to the recipient.

Telegraph batches payments, so several receipts can share one transaction. `receipt_hash` identifies each purchase, and each receipt claims one transfer, so one transfer cannot back two receipts.

## Verdict rules

| Result | Rule |
|---|---|
| HIGH RISK | A purchased check returned a confirmed flag: honeypot, hidden owner, reclaimable ownership or self-destruct (GoPlus); wash trading with HIGH risk, at least 50% of volume in round trips and at least 100 transfers; fraud verdict FRAUD, LIKELY_FRAUD or HIGH; or a sanctions match scoring at least 0.95 on an address or full name |
| CLEAR | Every planned check ran, each returned only clear signals, and sources do not conflict |
| CAUTION | Everything else, including any skipped, failed, unconfirmed or inconclusive check |

`src/lib/memo/verdict.ts` already turns any hard signal into HIGH RISK. What counts as "confirmed" is decided in `src/lib/agent/interpret.ts`.

**Why an audit finding alone is not HIGH RISK:** TxLens's review is an automated pattern check, and says so. On 2026-11-06 it flagged USDC's `upgradeTo()` at line 246 as having "no visible access check". The source at that line reads `function upgradeTo(address newImplementation) external ifAdmin`, so the function is guarded. A high finding therefore gives CAUTION with "needs human review".

## Evidence tiers

Each check carries a tier, separate from the memo's overall confidence.

| Tier | Meaning | Checks |
|---|---|---|
| 1 | Direct on-chain or registry reading | Sanctions, holder count, liquidity, price |
| 2 | Automated miner analysis | Contract audit, token controls, wash trading, fraud |
| 3 | Keyword or soft signal | Adverse media |
| 4 | Unverified: no usable or confirmed result | Any check that failed, stayed unconfirmed, or returned nothing readable |

Confidence is separate. Two or more skipped checks, no executed checks, or two or more gaps give low. Complete, consistent evidence from at least two checks gives high. Otherwise it is medium.

No LLM takes part in the verdict. Miner text is untrusted: it is only matched against fixed patterns, so instructions inside an article have no effect. A `200` proves delivery only, so the agent reads fields shaped to the intent and marked `ok`. The one exception is news: Telegraph's shaping can reject a real answer, so the miner's original text is read from the signal record, but only when its hash re-derives. Three forensic checks (contract audit, token controls, wash trading) get no shaped answer, because Telegraph publishes no format for them. They are read only from exact named fields, from one named miner, and only if the answer names the same contract. Anything else is inconclusive. A miner saying it found nothing never counts as a clean result, and neither does an all-clear with no sources.

## Engineering decisions

| Decision | Reason |
|---|---|
| Direct x402 library use, not the MCP server | The MCP server hides receipts from its caller, and this product must show them. It uses the same `@x402` libraries |
| Direct requests for news, routed for the rest | The top-ranked news miner searches spaceflight reports, so ranking alone is not enough. Live miners are always checked first |
| One second source, only for unusable answers | A miner's real "inconclusive" is an answer, so paying again would waste money |
| No sanctions or wash-trading purchase for a bare ticker | A ticker is not an identity, and a real wash-trading request analysed the wrong token |
| `exact` scheme, not `escrow` | Every purchase settles on-chain, so it can be verified independently |
| File storage, not PostgreSQL | Matches the suggested `data/assessments/` layout, and a judge can reproduce it with no database |
| Two audit-intent checks | They ask different questions. TxLens reviews code, and GoPlus reports owner powers and holder shares. Concentration is unavailable elsewhere, because `TOKEN_HOLDER_COUNT` returns only a count. This is not a cross-check, and no second source is ever bought for either |
| Mainnet token lookups, Sepolia payments | Forensic miners cover mainnet contracts. Lookups are free reads, so no mainnet funds are involved |
| Pool found through DexScreener | `LIQUIDITY_DEPTH` needs a pool address. The free lookup only finds the pool, and the figure itself is purchased |
| Browser extension as a thin client | It holds no assessment logic or wallet, and it calls the same API as the web app |
| Hand-written components in place of the shadcn CLI | Only a few primitives are needed, and they add no dependency |
| Symbols are not resolved to contracts | There is no free, authoritative lookup. The memo states this limit instead of guessing, and most forensic checks are skipped |
| Price check runs first for symbols | An unknown symbol stops further spending |
| SHA-256 and EIP-191 for signing | Recommended by the project brief. See the README for the exact scheme |

## Safety controls

- The private key stays server-side. `PAYMENT-SIGNATURE` is never recorded or logged.
- Limits: per request, per assessment, request count, and a lifetime total across stored runs.
- Only one run at a time. Runs start only from same-origin JSON requests or the browser extension. A website cannot forge an extension origin, and `ASSESS_API_KEY` can also require a key from it.
- A request is retried only if no payment was sent. A paid attempt is never retried.
- The app binds to `127.0.0.1` by default. A public deployment would let visitors spend up to the lifetime cap.
