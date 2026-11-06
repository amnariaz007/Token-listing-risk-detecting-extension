# Development checklist

Status of each milestone and hackathon acceptance criterion. Nothing is ticked unless it was run and observed.

**Last updated:** 2026-11-06

## Milestones

| # | Milestone | Status | Notes |
|---|---|---|---|
| 1 | Protocol discovery | Done | Docs and Telegraph-MCP source read. Live intents and miners queried. Capability report generated. |
| 2 | Telegraph integration | Done | Hard gate passed. Real paid requests completed, with receipts stored. See the proof below. |
| 3 | Autonomous agent | Done | Assessment LRM-2026-3LC6 ran end to end from one token input. |
| 4 | Risk engine and signed memo | Done | Signing and on-chain verification passed on real data. Real answers were read correctly, but two of four were not usable as evidence. |
| 5 | Frontend | Done | Six screens built and viewed against a real unfunded run. |
| 6 | Integration and QA | Partial | One funded run done. Answer quality from routed miners needs work, and only one token has been tried. |
| 7 | Deployment and submission | Not started | Needs a hosting decision. Demo video not recorded. |

## Acceptance criteria

- [x] Application runs successfully
- [x] Connects to the actual Telegraph development node
- [x] Live intents are discovered
- [x] Live miners are discovered
- [x] Only supported capabilities are used
- [x] At least one genuine paid Telegraph request is completed
- [x] The x402 payment flow is verifiable
- [x] Actual miner intelligence is received
- [x] Payment and response receipts are persisted
- [x] The autonomous agent executes the workflow, without manual steps
- [x] The risk memo is generated from actual evidence
- [x] The memo includes a real cost breakdown
- [x] The memo is cryptographically signed
- [x] Signature verification works
- [x] Evidence can be inspected by a judge
- [x] Invalid input is handled properly
- [x] Failed requests are represented honestly
- [x] All activity is explicitly labeled TESTNET
- [ ] Another developer can reproduce the assessment: instructions written, not independently tried

## What each test command proves

| Command | Network | Payment | Result on 2026-11-06 |
|---|---|---|---|
| `npm test` | None, simulated node | None | Passing |
| `npm run test:live` | Real devnode and Sepolia | None | 7 of 7 passing |
| `npm run test:paid` | Real devnode and Sepolia | **Real test USDC** | Not run yet: needs funding |

## First real assessment: LRM-2026-3LC6 (BTC, 2026-11-06)

`npm run verify -- data/assessments/LRM-2026-3LC6/bundle.json --onchain --signer 0x20091FED01F1aEa3E840d6984CFb110756B5Ab1c` returned VALID.

| Check | Miner | Result | Usable as evidence? |
|---|---|---|---|
| Market price | 190069 (Cp Coinbase) | $76,018.145 | Yes |
| Adverse media | 43010 (Spaceflight Reports Search) | No answer; sources "Boeing", "NASA" | No: wrong miner for the question |
| Fraud screen | 94217603 (Telegraph Sentinel) | INCONCLUSIVE | No: miner found no reliable answer |
| Sanctions screen | 710637 (Sanctions Name Evidence) | No match on the name "BTC" | Weak: a ticker is not an entity name |

Confirmed on this run: 402 then 200 on each request, `PAYMENT-RESPONSE` and `X-TELEGRAPH-RECEIPT` as documented, four settlements on-chain totalling 0.04 test USDC, and all four signal hashes re-derived.

## Later real assessments (2026-11-06)

| Memo | Input | What changed | Result |
|---|---|---|---|
| LRM-2026-XVK7 | BTC | Suited miners and a second source, with keyword queries | Weak answers. Fails verification now, because the coverage rule changed after it was signed |
| LRM-2026-LTR4 | BTC | Natural-language query | Paid for the news, but ignored its text. VALID |
| LRM-2026-JYYX | USD Coin contract on Sepolia | First address-based run | USDC price failed on four miners, and the 0.01 was credited to escrow. VALID |
| LRM-2026-KS5X | BTC | Reads the verified original answer | **First real adverse-news finding.** VALID |

## What was learned from real answers

1. A top leaderboard rank does not mean a miner suits the question: the #1 news miner searches spaceflight reports.
2. Telegraph's shaping can reject a real answer. The original stays in the signal record, and its hash can be verified.
3. The same question to the same miner can return different results. TxLens answered once, then found nothing.
4. "I found nothing" must never read as "nothing bad exists".
5. A routed request can analyse the wrong token: a wash-trading request for BTC analysed WETH.

## Forensic upgrade (2026-11-06)

| Item | Status | Proof |
|---|---|---|
| Forensic checks | Done | LRM-2026-MK4Y: UNI, six checks, CLEAR, VALID on-chain |
| Per-check tiers | Done | Column on the memo, appendix, results page and extension |
| Browser extension | Done | Clicked by a person on live Etherscan: LRM-2026-XK9V. VALID on-chain |
| Watchlist batch | Done | B-892E3785: five tokens ranked, 0.30 test USDC |
| Evidence run saved | Done | `evidence/` |

Read [GAPS.md](GAPS.md) before trusting a result.

## Open issues

1. The extension has not been clicked on live DEXScreener. See GAPS.md.
2. HIGH RISK has been produced only with simulated flags, or under a rule since corrected. No real token has triggered it under current rules.
3. `npm run test:paid` has not been run.
4. Decide whether to delete LRM-2026-XVK7, which now fails verification because the coverage rule changed, and LRM-2026-6YNA and LRM-2026-UUFK, which rated USDC and PEPE HIGH RISK under the corrected audit rule. Stored runs are never changed automatically.
