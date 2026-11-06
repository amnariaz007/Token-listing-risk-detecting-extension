# Read before trusting

What this project has not verified, what it skips, and what its labels really mean. Last updated 2026-11-06.

## What a result does and does not mean

- **CLEAR is not safe.** It means six automated checks found nothing. It is not a security audit, legal opinion or listing recommendation.
- **HIGH RISK has not been seen on a real token under the current rules.** Those rules are tested with simulated flags. The only real HIGH RISK results (LRM-2026-6YNA and LRM-2026-UUFK) came from an earlier rule that was wrong, and they rated USDC and PEPE too harshly.
- **The thresholds are my judgment,** not an industry standard: $50,000 liquidity, 100 holders, 50% top-wallet share, 10% tax, and the wash-trading limits. They are in `src/lib/agent/interpret.ts`.

## What a tier really means

| Tier | What it means | What it does not mean |
|---|---|---|
| T1 | A miner read a chain, list or registry directly | That the miner is infallible. T1 readings are not independently repeated |
| T2 | Automated analysis by a miner | Human review. T2 includes a pattern scanner with known false alarms |
| T3 | Keyword matching on news text | That the news is true, or about the token itself |
| T4 | No usable or confirmed result | Anything about the token |

## Known weak spots by check

| Check | Limit |
|---|---|
| Contract audit | A pattern scanner. It flagged USDC's `upgradeTo()` as unguarded, though line 246 of the source has the `ifAdmin` modifier. It also reads only the contract at the address, so a proxy's implementation may not be reviewed. High findings therefore give only CAUTION |
| Token controls | Trusts GoPlus's flags. Owner powers such as blacklisting are normal for regulated stablecoins, so USDC and USDT will not reach CLEAR |
| Holder concentration | Counts only ordinary wallets in the top 10, and leaves out contracts. A team could hide supply in a contract or across many wallets |
| Wash trading | A heuristic over the last 600 blocks, about 2 hours on Ethereum, and the miner says it is not proof of intent. The same token can read differently between runs: USDC read LOW and then ELEVATED on the same day |
| Holder count | A count only. The live intent returns no distribution |
| Liquidity | The reserve of the largest pool only. **Slippage and order-book depth are not measured,** because the live intent returns neither. The pool is found through DexScreener, which is not a Telegraph purchase |
| Sanctions | Screens the contract address. It does not screen the team, treasury or deployer, and name matches are not proof of identity |
| Adverse media | Can flag news about related companies. Only used for bare symbols |
| Fraud screen | Often returns INCONCLUSIVE for token names. Only used for bare symbols |

## Departures from a strict schema-only approach

Telegraph publishes no response format for contract audits, and it does not shape the wash-trading miner's own API. Reading only shaped fields would mean always skipping both. So these checks read exact named fields, from one named miner, and only if the answer names the same contract. Any other answer is inconclusive. Those field names could change without notice, and the result would then read as inconclusive, not as clean.

## Not tested

- **The extension on live DEXScreener.** It was clicked on live Etherscan by a person, producing LRM-2026-XK9V. On DEXScreener, only the button's appearance on a stand-in page and the real pair-to-token lookup were tested.
- **Edge,** and the extension's API-key and hosted-address options.
- **Base, Arbitrum, Optimism and Polygon tokens.** Only Ethereum tokens have had real forensic runs. Identity reads and miner parameters for those chains are documented, not proven.
- **Sepolia tokens with the forensic checks.** They are skipped because the miners document no support, so a Sepolia token cannot reach CLEAR.
- **Independent reproduction.** No one other than the builder has followed the setup steps.
- **`npm run test:paid`.** The same flow ran through the CLI, the API and the extension instead.
- **Deployment.** It has only run on one local machine.

## Testnet only

- Payments are test USDC on Sepolia. Prices are testnet prices, and the USD figures are face value.
- Miners and rankings on this devnode may differ from a production network.
- A shared deployment would let visitors spend up to its limits, so it runs on `127.0.0.1` by default.

## Thin or inconsistent miners

| Intent | Observation on 2026-11-06 |
|---|---|
| `SMART_CONTRACT_AUDIT_GENERAL` | 15 listed, and no published format. Only TxLens and GoPlus are used. CodeWire timed out once, with HTTP 504 |
| `LIQUIDITY_DEPTH_VERIFY_GENERAL` | The leaderboard scored only two miners well |
| `NEWS_SEARCH_GENERAL` | The #1 ranked miner searches spaceflight reports, and TxLens gave different results to the same question |
| `CRYPTO_PRICE_USD` | Four miners failed on USDC in one run, and that payment was credited to escrow |
| `WASH_TRADING_DETECTION_GENERAL` | A routed request for a bare ticker analysed WETH instead, so requests go directly to one miner |

## Dependence on one operator

This agent has one wallet and one signing key. The signature proves that this application produced a memo, not that its contents are true. It does not come from Telegraph or from any miner.
