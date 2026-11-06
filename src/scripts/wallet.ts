import { existsSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { paymentAccount, walletStatus } from "../lib/blockchain/wallet.ts";

// Creates the Sepolia burner wallet if there is none, then prints public details only. The key is never printed.
if (!existsSync(".env")) {
  const key = generatePrivateKey();
  writeFileSync(".env", `# Dedicated Sepolia burner wallet. Never use on mainnet, never commit.\nTELEGRAPH_EVM_PRIVATE_KEY=${key}\n`, { flag: "wx", mode: 0o600 });
  process.env.TELEGRAPH_EVM_PRIVATE_KEY = key;
  console.log(`Created .env with a new burner wallet: ${privateKeyToAccount(key).address}`);
}
const status = await walletStatus();
console.log(`Address:  ${paymentAccount().address}`);
console.log(`Sepolia ETH: ${status.eth}`);
console.log(`Test USDC:   ${status.usdc}`);
if (Number(status.eth) === 0) console.log("\nNext: send about 0.005 Sepolia ETH to this address from a public faucet, then run: npm run fund");
else if (Number(status.usdc) < 0.05) console.log("\nNext: npm run fund");
