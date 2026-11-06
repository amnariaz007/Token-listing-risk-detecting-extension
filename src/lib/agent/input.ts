import { isAddress, getAddress } from "viem";
import type { TokenChain } from "../../config/protocol.ts";
import type { TokenIdentity } from "../blockchain/wallet.ts";

export class InputError extends Error {}

export type TokenTarget = {
  name: string | null;
  symbol: string;
  address: string | null;
  chain: string;
  identity_source: "onchain" | "user_input";
};

export const SYMBOL_NOT_RESOLVED = "not resolved (symbol input)";

/** Validates input and returns a verified target. A token is never swapped for a similar one. */
export async function resolveToken(rawInput: unknown, chain: TokenChain, readIdentity: (address: string, chain: TokenChain) => Promise<TokenIdentity | null>): Promise<TokenTarget> {
  const input = typeof rawInput === "string" ? rawInput.trim() : "";
  if (!input) throw new InputError("Enter a token symbol or a contract address.");
  if (input.startsWith("0x") || input.startsWith("0X")) {
    if (!isAddress(input, { strict: false })) throw new InputError("That is not a valid contract address. It should be 0x followed by 40 hex characters.");
    const address = getAddress(input.toLowerCase());
    let identity: TokenIdentity | null;
    try {
      identity = await readIdentity(address, chain);
    } catch (err) {
      throw new InputError(`Could not read the contract from ${chain}: ${(err as Error).message}`);
    }
    if (!identity) throw new InputError(`No ERC-20 token was found at that address on ${chain}. Check the address and the chain.`);
    return { name: identity.name, symbol: identity.symbol, address, chain, identity_source: "onchain" };
  }
  if (!/^[A-Za-z0-9$._-]{1,15}$/.test(input)) throw new InputError("A symbol should be 1 to 15 letters or digits, such as USDC.");
  return { name: null, symbol: input.toUpperCase(), address: null, chain: SYMBOL_NOT_RESOLVED, identity_source: "user_input" };
}
