import "dotenv/config";
import { createPublicClient, erc20Abi, formatEther, formatUnits, http, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { TEST_USDC, TOKEN_CHAINS, rpcUrl, type TokenChain } from "../../config/protocol.ts";

export class MissingWalletError extends Error {}

export function sepoliaClient(): PublicClient {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl()) }) as PublicClient;
}

export function paymentAccount() {
  const key = process.env.TELEGRAPH_EVM_PRIVATE_KEY;
  if (!key) throw new MissingWalletError("No burner wallet is configured. Run: npm run wallet");
  return privateKeyToAccount(key as Hex);
}

export function signerAccount() {
  const key = process.env.MEMO_SIGNER_PRIVATE_KEY;
  return key ? privateKeyToAccount(key as Hex) : paymentAccount();
}

export type WalletStatus = { address: string; eth: string; usdc: string; usdc_atomic: string };

/** Public balances only. The private key never leaves this process. */
export async function walletStatus(client: PublicClient = sepoliaClient()): Promise<WalletStatus> {
  const { address } = paymentAccount();
  const [wei, usdc] = await Promise.all([
    client.getBalance({ address }),
    client.readContract({ address: TEST_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
  ]);
  return { address, eth: formatEther(wei), usdc: formatUnits(usdc, 6), usdc_atomic: usdc.toString() };
}

export type TokenIdentity = { name: string | null; symbol: string; decimals: number };

/** Reads a token's identity from its own contract, on its own chain, so address input gets verified metadata. */
export async function readTokenIdentity(address: string, chain: TokenChain, client: PublicClient = createPublicClient({ transport: http(TOKEN_CHAINS[chain].rpc) }) as PublicClient): Promise<TokenIdentity | null> {
  const contract = address as Hex;
  const code = await client.getCode({ address: contract });
  if (!code || code === "0x") return null;
  const [name, symbol, decimals] = await Promise.allSettled([
    client.readContract({ address: contract, abi: erc20Abi, functionName: "name" }),
    client.readContract({ address: contract, abi: erc20Abi, functionName: "symbol" }),
    client.readContract({ address: contract, abi: erc20Abi, functionName: "decimals" }),
  ]);
  if (symbol.status !== "fulfilled" || decimals.status !== "fulfilled") return null;
  return { name: name.status === "fulfilled" ? name.value : null, symbol: symbol.value, decimals: decimals.value };
}
