import "dotenv/config";
import { describe, expect, it } from "vitest";
import { limits } from "../../src/config/protocol.ts";
import { runAssessment, type AgentEvent } from "../../src/lib/agent/orchestrator.ts";
import { liveDeps } from "../../src/lib/agent/runtime.ts";
import { verifyBundle } from "../../src/lib/memo/verify.ts";
import { createStore } from "../../src/lib/storage/assessments.ts";

/* REAL PAYMENTS. Spends test USDC from the burner wallet. Runs only through: npm run test:paid */
describe.runIf(process.env.RUN_PAID_TESTS === "1")("live paid assessment", () => {
  it("buys real intelligence and produces a verifiable signed memo", async () => {
    const store = createStore();
    const events: AgentEvent[] = [];
    const result = await runAssessment("0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", liveDeps(limits().maxAssessmentAtomic, store, (e) => events.push(e)), "ethereum");
    store.save(result, events);
    const { memo } = result.bundle.signed;
    expect(memo.cost.checks_paid).toBeGreaterThan(0);
    for (const c of memo.checks.filter((x) => x.status === "ok")) {
      expect(c.payment?.status).toBe("confirmed");
      expect(c.receipt_reference).toBeTruthy();
    }
    expect((await verifyBundle(result.bundle)).valid).toBe(true);
  }, 300_000);
});
