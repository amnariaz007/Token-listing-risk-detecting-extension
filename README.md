# Token Listing Risk

A listing desk's forensic analyst, inside the block explorer. Click one button on a token's page, and an agent buys forensic intelligence on Telegraph and returns a signed memo with a receipt for every claim.

Built for Telegraph Protocol Hackathon Season II, Apps & Agents, **Mission 01: Exchange**.

**Who it is for:** exchange listing desks, OTC desks and compliance teams deciding whether to list or trade a token. It is not a transaction-safety tool: it answers "should we list this token?", not "is this transfer safe?".

**Testnet only:** all payments are test USDC on Ethereum Sepolia. Tokens can be on mainnet chains, which are only read.

**Read [docs/GAPS.md](docs/GAPS.md) before trusting a result.**

## Problem

Listing reviews take analysts a long time, and it is hard to show later what a decision was based on or what it cost.

## Solution

Give it a token, from the extension, the web app or a watchlist of up to ten. The agent then:

1. Reads which intelligence is live on Telegraph.
2. Chooses up to six checks and explains why: contract audit, token controls and holder concentration, sanctions, wash trading, holder count, and liquidity.
3. Pays for each one with an x402 payment, within a fixed budget.
4. Verifies each payment against Telegraph's receipt and the chain.
5. Applies deterministic rules to reach a verdict.
6. Signs a one-page memo, stating what it could not check.

Failed and skipped checks stay visible, and a missing check never counts as a pass.

## How it fits together

- **Reuses and combines:** it fuses several independent Telegraph signals into one listing decision, and adds forensic depth, evidence tiers and signed receipts. Open-source components are listed under Technology.
- **What runs where:** the app holds the wallet and all logic. The extension is a thin client.

## Reading a memo

| Verdict | Meaning |
|---|---|
| **HIGH RISK** | A paid source returned a material red flag, such as a sanctions match on the token's identity. |
| **CAUTION** | Soft negatives, conflicting sources, or gaps in the evidence. This is the default when evidence is insufficient. |
| **CLEAR** | Every planned check ran and returned clear evidence. It is not a guarantee of safety. |

Confidence and evidence coverage are reported separately from the verdict.

Each row also has a tier, from T1 (a direct reading) to T4 (unverified).

**A real example, from one batch:** UNI and LINK came back CLEAR. USDC and USDT came back CAUTION, for owner powers such as upgrades, pausing or blacklisting that a listing desk would want to review.

## Verifying a memo yourself

```bash
npm run verify -- data/assessments/<id>/bundle.json --signer <expected signer> --onchain
```

This checks the signature, the memo hash, the verdict and cost logic, and the raw responses. With `--onchain`, it also re-reads each payment from Sepolia and re-derives each signal hash.

Pass `--signer`, because anyone can sign a memo with their own key.

**Signature scheme (`lrm-sig/v1`):**

- `memo_hash = sha256(UTF-8 bytes of the RFC 8785 canonical JSON of the memo)`
- `signature = EIP-191 personal_sign over the 32 raw bytes of memo_hash`

This is the application's signature. It is separate from Telegraph's receipts, and no miner signs the memo.

## Quick start

```bash
npm install
npm run wallet           # creates a burner wallet in .env
# send about 0.005 Sepolia ETH to the printed address
npm run fund             # mints 10 free test USDC
npm run first-purchase   # one real paid request
npm run build && npm start
```

Open http://127.0.0.1:4402. Full steps, including loading the extension, are in [docs/SETUP.md](docs/SETUP.md).

## Technology

Next.js, React, TypeScript, Tailwind, Zod, viem, `@x402/fetch` and `@x402/evm`, pdfkit, and vitest.

## Documentation

| Document | Contents |
|---|---|
| [docs/GAPS.md](docs/GAPS.md) | What is unverified or limited |
| [docs/DEMO.md](docs/DEMO.md) | Judge journey, with expected output |
| [evidence/](evidence/) | A saved real run: receipts and signed memo |
| [docs/SETUP.md](docs/SETUP.md) | Exact reproduction steps |
| [docs/CODE_MAP.md](docs/CODE_MAP.md) | Every file and function, and where to change what |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Design, rules and decisions |
| [docs/TELEGRAPH_CAPABILITIES.md](docs/TELEGRAPH_CAPABILITIES.md) | Live capability report |
| [docs/COMMERCIAL_SUMMARY.md](docs/COMMERCIAL_SUMMARY.md) | Commercial summary |
| [docs/CHECKLIST.md](docs/CHECKLIST.md) | Status against the acceptance criteria |

`examples/` holds a labelled synthetic memo that shows the format. It is not evidence of a purchase.

## Security notes

- The burner wallet's key stays in the git-ignored `.env`, and payment signatures are never stored or logged.
- Quotes are checked for network, token, recipient and amount before anything is signed.
- Spending is capped per request, per assessment and in total.
- Miner output is treated as untrusted data and is never executed.

## Known limitations

See [docs/GAPS.md](docs/GAPS.md).
