import { createWalletClient, http, parseAbi } from "viem";
import { sepolia } from "viem/chains";
import { TEST_USDC, rpcUrl } from "../config/protocol.ts";
import { paymentAccount, sepoliaClient, walletStatus } from "../lib/blockchain/wallet.ts";

// Mints 10 test USDC to the burner wallet, using the free mint documented by Telegraph. Sepolia only.
const account = paymentAccount();
const client = sepoliaClient();
const before = await walletStatus(client);
if (Number(before.eth) === 0) {
  console.error(`${account.address} has no Sepolia ETH to pay gas for the mint. Send about 0.005 Sepolia ETH from a public faucet first.`);
  process.exit(1);
}
const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl()) });
const hash = await wallet.writeContract({ address: TEST_USDC, abi: parseAbi(["function mint(address to, uint256 amount)"]), functionName: "mint", args: [account.address, 10_000_000n] });
console.log(`Mint sent: https://sepolia.etherscan.io/tx/${hash}`);
const receipt = await client.waitForTransactionReceipt({ hash, timeout: 180_000 });
if (receipt.status !== "success") {
  console.error("The mint transaction reverted.");
  process.exit(1);
}
const after = await walletStatus(client);
console.log(`Test USDC balance: ${after.usdc}`);
