# Saved evidence run

A real paid assessment, started by clicking the browser extension in Chrome on 2026-11-06. Nothing here is simulated.

- **Token:** Uniswap (UNI), `0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984`, on ethereum
- **Verdict:** CLEAR, confidence high, 6 of 6 checks
- **Paid:** 0.06 test USDC on Ethereum Sepolia
- **Memo hash:** `0x1429dc529e87b82a555489e382586e9635c99561b8c525d9802556759a4b803a`
- **Signer:** `0x20091FED01F1aEa3E840d6984CFb110756B5Ab1c`

| Check | Finding | Tier | Miner | Settlement |
|---|---|---|---|---|
| Contract audit | No high or medium findings | T2 | `9002` | [`0xd35a6b186b...`](https://sepolia.etherscan.io/tx/0xd35a6b186b07e064b437624926f3f068c833c77826d794983cd45953963f6432) |
| Token controls | No risky controls; top wallets 14.3% | T2 | `200001` | [`0xe5cec3d005...`](https://sepolia.etherscan.io/tx/0xe5cec3d00579e53311d185ef7b15c1613af10622afb2bfa36dcbad783e4f2305) |
| Sanctions screen | No list match | T1 | `710637` | [`0x30e55cdb8c...`](https://sepolia.etherscan.io/tx/0x30e55cdb8ce5213f5b89b4a6e846bb01ff7c3d875db2594015dbc00e6356f9e0) |
| Wash trading | LOW risk, 1.16% round-trip | T2 | `7378` | [`0xe7e8cbd282...`](https://sepolia.etherscan.io/tx/0xe7e8cbd2826bc9b16f5d7ae042262567111beaa7f86eb7cfc91548f1a4bb0927) |
| Holder count | 429,171 holders | T1 | `7302` | [`0xc5c953f2c6...`](https://sepolia.etherscan.io/tx/0xc5c953f2c680dd0b3e6c19761dcb7df37f3ef5f8631025fa86bbe5cc6c574e76) |
| Liquidity | $14,540,640 top pool | T1 | `7373` | [`0x8ed6c12c89...`](https://sepolia.etherscan.io/tx/0x8ed6c12c8945b9fd1dffadd3ca0cc825b4da9d16c955a6e350e8381050242826) |

## Verify it yourself

```bash
npm run verify -- evidence/LRM-2026-TWEK/bundle.json --onchain --signer 0x20091FED01F1aEa3E840d6984CFb110756B5Ab1c
```

## Files

| File | Contents |
|---|---|
| `LRM-2026-TWEK/input.json` | The token input |
| `LRM-2026-TWEK/capabilities.json` | The live capabilities the agent saw |
| `LRM-2026-TWEK/plan.json` | What it chose, and why |
| `LRM-2026-TWEK/requests.json` | Each request and its HTTP sequence, 402 then paid result |
| `LRM-2026-TWEK/payments.json` | Payment terms, settlement proofs and Telegraph receipts |
| `LRM-2026-TWEK/results.json` | Raw miner answers and stored signals |
| `LRM-2026-TWEK/memo.json`, `signature.json` | The signed memo |
| `LRM-2026-TWEK/bundle.json` | All of the above, for verification |
| `extension-panel.png` | The extension showing this result. The page behind it is a stand-in: see docs/GAPS.md |
| `watchlist/` | A real five-token ranking (batch +process.argv[1]+), and the USDC memo with its unconfirmed audit finding |
