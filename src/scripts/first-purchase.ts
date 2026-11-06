import { wrapFetchWithPayment } from "@x402/fetch";
import { formatUnits } from "viem";
import { limits } from "../config/protocol.ts";
import { paymentAccount, sepoliaClient, walletStatus } from "../lib/blockchain/wallet.ts";
import { buyIntelligence } from "../lib/telegraph/client.ts";
import { Budget, createPaymentClient } from "../lib/telegraph/payments.ts";
import { checkSignal } from "../lib/telegraph/signal.ts";

// Milestone 2 gate: one real paid request, printing everything the protocol returns. Costs about 0.01 test USDC.
const account = paymentAccount();
const client = sepoliaClient();
const before = await walletStatus(client);
console.log(`Wallet ${account.address}: ${before.usdc} test USDC`);
const l = limits();
const payments = createPaymentClient(account, client, l.maxRequestAtomic);
const purchase = await buyIntelligence("CRYPTO_PRICE_USD", { symbol: process.argv[2] ?? "BTC" }, {
  payFetch: (base) => wrapFetchWithPayment(base, payments),
  budget: new Budget(l.maxRequestAtomic, l.maxRequestAtomic, 1),
});
console.log("HTTP sequence:", purchase.exchanges.map((e) => e.status).join(" -> "));
console.log("Challenge:", purchase.challenge);
console.log("Settlement:", purchase.settlement);
console.log("Receipt:", purchase.receipt);
console.log("Response:", purchase.bodyText);
if (purchase.error) console.log("Error:", purchase.error);
const body = JSON.parse(purchase.bodyText ?? "{}") as { signal_hash?: string };
if (body.signal_hash) {
  const signal = await checkSignal(body.signal_hash);
  console.log(`Signal: ${signal.detail}. Verified: ${signal.verified}. Paid by: ${signal.wallet}`);
}
const after = await walletStatus(client);
console.log(`Balance change: ${formatUnits(BigInt(before.usdc_atomic) - BigInt(after.usdc_atomic), 6)} test USDC`);
