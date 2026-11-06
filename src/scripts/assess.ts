import { isTokenChain, limits } from "../config/protocol.ts";
import { runAssessment } from "../lib/agent/orchestrator.ts";
import { liveDeps } from "../lib/agent/runtime.ts";
import { paymentAccount, walletStatus } from "../lib/blockchain/wallet.ts";
import { renderMemo } from "../lib/memo/render.ts";
import { createStore } from "../lib/storage/assessments.ts";
import type { AgentEvent } from "../lib/agent/orchestrator.ts";

// Usage: npm run assess -- <address or symbol> [chain]
const input = process.argv[2];
const chain = process.argv[3] ?? "ethereum";
if (!isTokenChain(chain)) throw new Error(`Unknown chain: ${chain}`);
const store = createStore();
const events: AgentEvent[] = [];
console.log(`Wallet ${paymentAccount().address}, ${(await walletStatus()).usdc} test USDC`);
const result = await runAssessment(input, liveDeps(limits().maxAssessmentAtomic, store, (e) => {
  events.push(e);
  console.log(`[${e.step}] ${e.message}`);
}), chain);
store.save(result, events);
console.log(`\n${renderMemo(result.bundle.signed.memo)}`);
console.log(`\nEvidence: data/assessments/${result.bundle.signed.memo.memo_id}/`);
