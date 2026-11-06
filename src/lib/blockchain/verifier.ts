import { erc20Abi, formatUnits, parseEventLogs, type Hex, type PublicClient } from "viem";

export type SettlementFacts = { transfers: bigint[]; decimals: number; currency: string; blockNumber: string };
export type SettlementReader = (query: { txHash: string; asset: string; payer: string; payTo: string }) => Promise<SettlementFacts>;

/** Reads what actually moved on-chain: every transfer of the asset from the payer to the recipient in the transaction. */
export function createSettlementReader(client: PublicClient): SettlementReader {
  return async ({ txHash, asset, payer, payTo }) => {
    const receipt = await client.waitForTransactionReceipt({ hash: txHash as Hex, timeout: 90_000 });
    if (receipt.status !== "success") throw new Error(`Settlement ${txHash} reverted`);
    const transfers = parseEventLogs({ abi: erc20Abi, eventName: "Transfer", logs: receipt.logs })
      .filter(
        (log) =>
          log.address.toLowerCase() === asset.toLowerCase() &&
          log.args.from.toLowerCase() === payer.toLowerCase() &&
          log.args.to.toLowerCase() === payTo.toLowerCase(),
      )
      .map((log) => log.args.value);
    const [decimals, currency] = await Promise.all([
      client.readContract({ address: asset as Hex, abi: erc20Abi, functionName: "decimals" }),
      client.readContract({ address: asset as Hex, abi: erc20Abi, functionName: "symbol" }),
    ]);
    return { transfers, decimals, currency, blockNumber: receipt.blockNumber.toString() };
  };
}

export type ConfirmedPayment = { amountAtomic: string; amount: string; decimals: number; currency: string; blockNumber: string; txHash: string };

/**
 * Telegraph's facilitator batches payments, so one transaction can settle several purchases.
 * Each purchase claims one matching transfer, which stops a single transfer backing two receipts.
 */
export class SettlementLedger {
  private facts = new Map<string, Promise<SettlementFacts>>();
  private claimed = new Map<string, bigint[]>();
  constructor(private read: SettlementReader) {}

  async confirm(query: { txHash: string; asset: string; payer: string; payTo: string; amountAtomic: bigint }): Promise<ConfirmedPayment> {
    const key = query.txHash.toLowerCase();
    if (!this.facts.has(key)) this.facts.set(key, this.read(query));
    const facts = await (this.facts.get(key) as Promise<SettlementFacts>);
    const used = this.claimed.get(key) ?? [];
    const available = [...facts.transfers];
    for (const value of used) available.splice(available.indexOf(value), 1);
    if (!available.includes(query.amountAtomic)) {
      throw new Error(`Transaction ${query.txHash} has no unclaimed transfer of ${query.amountAtomic} from the payer to the recipient`);
    }
    this.claimed.set(key, [...used, query.amountAtomic]);
    return {
      amountAtomic: query.amountAtomic.toString(),
      amount: formatUnits(query.amountAtomic, facts.decimals),
      decimals: facts.decimals,
      currency: facts.currency,
      blockNumber: facts.blockNumber,
      txHash: query.txHash,
    };
  }
}
