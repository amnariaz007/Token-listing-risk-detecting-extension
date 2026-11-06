# Setup

Reproduces a full assessment on Ethereum Sepolia. This uses test tokens only.

## 1. Requirements

Node.js 20 or newer. Paid calls fail on Node 18.

## 2. Install

```bash
npm install
```

## 3. Create the burner wallet

```bash
npm run wallet
```

This creates `.env` with a new key and prints the address. The key is never printed, and `.env` is git-ignored. Use this wallet for nothing else.

See `.env.example` for the optional settings and spending limits.

## 4. Get Sepolia ETH

Send about 0.005 Sepolia ETH to the printed address from a public faucet, such as [Google Cloud](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) or [Alchemy](https://www.alchemy.com/faucets/ethereum-sepolia). Most faucets need a sign-in or a small mainnet balance.

ETH is needed only to pay gas for the mint in the next step. x402 payments themselves are gasless for the payer.

## 5. Mint test USDC

```bash
npm run fund
```

This mints 10 test USDC (`0xcc194e1a843B658526D0D5C431f670028582Ae17`) through the free mint Telegraph documents.

## 6. Make the first purchase

```bash
npm run first-purchase
```

This costs about 0.01 test USDC and prints the full sequence: the 402, the settlement, the receipt and the miner response.

## 7. Start the application

```bash
npm run build
npm start
```

Open http://127.0.0.1:4402. There is no separate MCP setup: this application pays with the same `@x402` libraries directly.

## 8. Run a sample assessment

Choose **New assessment**, enter `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984`, keep the chain on Ethereum, and start it. You can also run `npm run assess -- 0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984 ethereum`.

Expect six purchases, 0.06 test USDC, and a signed memo. No mainnet funds are used: the token is only looked up on mainnet, and payment stays on Sepolia.

To test a failure, enter `0x123` (invalid input) or set the budget to `0.001` (nothing is bought).

## Optional: the browser extension

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Choose **Load unpacked**, and select the `extension` folder.
3. With the app running, open a token page such as https://etherscan.io/token/0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984.
4. Click **Listing Risk** at the bottom right, then **Run listing-risk assessment**.

If the app is not at `http://127.0.0.1:4402`, set its address in the extension's options.

## 9. Inspect the evidence

- **In the app:** open the assessment, then **Evidence**.
- **On disk:** `data/assessments/<id>/` holds `input`, `capabilities`, `plan`, `requests`, `payments`, `results`, `memo` and `signature` JSON files.
- **Independently:**

```bash
npm run verify -- data/assessments/<id>/bundle.json --signer <signer address> --onchain
```

## Troubleshooting

| Message | What to do |
|---|---|
| `insufficient_funds` | Run `npm run fund` |
| `has no Sepolia ETH` | Repeat step 4 |
| `No burner wallet is configured` | Run `npm run wallet` |
| `Refused: recipient ... is not the documented Telegraph Diamond` | The protocol configuration changed. Check the addresses page, then update `src/config/protocol.ts` |
| Every check reads as inconclusive | The miners' answers did not match their intent format. The raw answers are in the Evidence screen |

## Tests

```bash
npm test              # simulated node, no network
npm run test:live     # real node and Sepolia, no payment
npm run test:paid     # real node, spends test USDC
```
