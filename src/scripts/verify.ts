import { readFileSync } from "node:fs";
import { EvidenceBundleSchema } from "../lib/memo/schema.ts";
import { verifyBundle } from "../lib/memo/verify.ts";
import { rpcUrl } from "../config/protocol.ts";
import { createSettlementReader } from "../lib/blockchain/verifier.ts";
import { sepoliaClient } from "../lib/blockchain/wallet.ts";
import { checkSignal } from "../lib/telegraph/signal.ts";

// Usage: npm run verify -- <bundle.json> [--signer 0x...] [--onchain]
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--signer");
if (!file) {
  console.error("Usage: npm run verify -- <bundle.json> [--signer 0x...] [--onchain]");
  process.exit(2);
}
const signerFlag = args.indexOf("--signer");
const input = JSON.parse(readFileSync(file, "utf8"));
const result = await verifyBundle(input, signerFlag >= 0 ? args[signerFlag + 1] : undefined);
const errors = [...result.errors];

if (args.includes("--onchain") && result.memo_hash) {
  const { signed } = EvidenceBundleSchema.parse(input);
  const read = createSettlementReader(sepoliaClient());
  console.log(`Re-reading settlements from ${rpcUrl()}`);
  for (const c of signed.memo.checks) {
    const p = c.payment;
    if (p?.status !== "confirmed") continue;
    try {
      const chain = await read({ txHash: p.tx_hash!, asset: p.asset, payer: p.payer!, payTo: p.pay_to });
      const found = chain.transfers.includes(BigInt(p.amount_atomic!));
      console.log(`  ${c.name}: ${p.tx_hash} ${found ? "holds" : "DOES NOT HOLD"} a transfer of ${p.amount} ${chain.currency}`);
      if (!found) errors.push(`${c.name}: no matching on-chain transfer`);
    } catch (err) {
      errors.push(`${c.name}: ${(err as Error).message}`);
    }
    if (c.signal_hash) {
      const signal = await checkSignal(c.signal_hash);
      console.log(`  ${c.name}: signal ${c.signal_hash} ${signal.verified ? "re-derives" : `not verified (${signal.detail})`}`);
      if (signal.verified === false) errors.push(`${c.name}: signal hash does not re-derive`);
    }
  }
}

console.log(`Memo hash:        ${result.memo_hash ?? "n/a"}`);
console.log(`Recovered signer: ${result.recovered_signer ?? "n/a"}`);
if (errors.length > 0) {
  console.log("Result:           INVALID");
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}
console.log("Result:           VALID");
