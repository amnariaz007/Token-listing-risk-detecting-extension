# Judge journey

About 10 minutes the first time. Everything runs on Ethereum Sepolia test tokens, and no mainnet funds are needed.

## Prerequisites

- Node.js 20 or newer, and Chrome or Edge.
- About 0.005 Sepolia ETH from a public faucet, for the free USDC mint.

## 1. Fund the wallet

```bash
npm install
npm run wallet      # creates a burner wallet and prints its address
# send about 0.005 Sepolia ETH to that address
npm run fund        # mints 10 free test USDC
```

## 2. Start the app

```bash
npm run build
npm start
```

Open http://127.0.0.1:4402. The dashboard should show the node as Online and your test USDC balance.

## 3. Assess a named token

Choose **New assessment**. Enter Uniswap's token, keep the chain on Ethereum, and start:

```
0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984
```

You will watch the agent find the pool, plan six checks, receive a 402 for each, pay, and verify.

### Expected output

This is what three real runs returned on 2026-11-06. Live data can change, so yours may differ. A wash-trading scan, for example, reads only recent transfers.

| Field | Expected |
|---|---|
| Verdict | CLEAR |
| Confidence | high |
| Coverage | 6 of 6 planned checks executed |
| Total paid | 0.06 USDC |
| Duration | About 40 seconds |

| Check | Tier | Finding |
|---|---|---|
| Contract audit | T2 | No high or medium findings |
| Token controls | T2 | No risky controls; top wallets about 14% |
| Sanctions screen | T1 | No list match |
| Wash trading | T2 | LOW risk |
| Holder count | T1 | About 415,000 to 430,000 holders |
| Liquidity | T1 | About $14.5 million in the top pool |

To see the app say something other than CLEAR, assess USDC, which returned CAUTION for an unconfirmed audit finding and an upgradeable proxy:

```
0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
```

## 4. Inspect the receipts

On the results page, choose **Evidence**. Each check shows the request, the HTTP 402, the payment terms, Telegraph's receipt, the settlement on Sepolia Etherscan, the miner's answer, and the signal hash.

## 5. Verify the signature yourself

On the memo page, choose **Verify again**. Then check it independently, using the memo ID and the signer shown on that page:

```bash
npm run verify -- data/assessments/<memo id>/bundle.json --onchain --signer <signer address>
```

It should end with `Result: VALID`. To see it refuse a tampered memo, change `"verdict": "CLEAR"` to `"verdict": "CAUTION"` in a copy of the file, and run it on the copy.

## 6. Open the extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked**, and select the `extension` folder.
3. Keep the app running, and open https://etherscan.io/token/0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984.
4. Click **Listing Risk** at the bottom right, then **Run listing-risk assessment**.

The panel shows the verdict, the evidence table, the cost line, the signature status, and links to the memo and receipts. This costs another 0.06 test USDC.

It also works on DEXScreener pair pages and on Basescan, Arbiscan, Optimistic Etherscan, Polygonscan and Sepolia Etherscan token pages.

## 7. Run a watchlist

Choose **Watchlist**, and paste:

```
0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
0xdAC17F958D2ee523a2206206994597C13D831ec7
0x6982508145454Ce325dDbE47a25d4ec3d2311933
0x514910771AF9Ca656af840dff83E8264EcF986CA
0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984
```

You get a table ranked riskiest first, with each row linking to its own signed memo. It costs about 0.30 test USDC and took about 4 minutes.

## 8. Try failure cases (no spending)

- Enter `0x123`: a clear input error.
- Set the budget to `0.001`: nothing is bought, and the results page says so.
- Enter a Sepolia contract on the Ethereum Sepolia chain: the forensic checks are skipped, each with its reason.

## Video outline (2 to 5 minutes)

| Time | Show | Say |
|---|---|---|
| 0:00 | Etherscan token page | "A listing review takes weeks. Here's a first pass from inside the block explorer." |
| 0:20 | Click the extension | "One click. The agent chooses the checks and pays per request, with test USDC." |
| 1:00 | App's execution screen | "Each request gets a 402, and the agent checks the price, token and recipient before signing." |
| 1:45 | Memo | "Verdict, confidence, a tier for every check, what was skipped, and the actual cost." |
| 2:30 | USDC result | "It doesn't overclaim. The scanner flagged USDC, but the function is guarded, so this says 'needs human review'." |
| 3:15 | Receipts and Etherscan | "Every row has a receipt, and every payment is on-chain." |
| 3:45 | `npm run verify` | "Anyone can verify it, and changing any field breaks it." |
| 4:15 | Watchlist | "And it ranks a whole watchlist." |
