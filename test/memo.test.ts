import { describe, expect, it } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { sha256, toBytes } from "viem";
import { renderAppendix } from "../src/lib/memo/appendix.ts";
import { canonicalize, hashMemo } from "../src/lib/memo/canonical.ts";
import { computeCost } from "../src/lib/memo/cost.ts";
import { renderPdf } from "../src/lib/memo/pdf.ts";
import { renderMemo } from "../src/lib/memo/render.ts";
import { EvidenceBundleSchema, MemoSchema, type Memo } from "../src/lib/memo/schema.ts";
import { issueCorrection, signMemo, verifySignedMemo } from "../src/lib/memo/sign.ts";
import { assertValidMemo, findIntegrityViolations } from "../src/lib/memo/validate.ts";
import { verifyBundle } from "../src/lib/memo/verify.ts";
import { bundleFrom, cautionBundle, clear, failedCheck, hard, inconclusiveSignal, memoFrom, okCheck, skippedCheck, soft, TEST_SIGNER } from "./fixtures.ts";

async function pdfPages(pdf: Buffer): Promise<string[]> {
  const doc = await getDocument({ data: new Uint8Array(pdf), verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    pages.push(content.items.map((item) => ("str" in item ? item.str + (item.hasEOL ? "\n" : "") : "")).join(""));
  }
  return pages;
}
const squash = (s: string) => s.replace(/\s+/g, "");
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** Every leaf path in an object, so tamper tests cover all signed fields. */
function leafPaths(value: unknown, prefix: (string | number)[] = []): (string | number)[][] {
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => leafPaths(v, [...prefix, Array.isArray(value) ? Number(k) : k]));
  }
  return [prefix];
}
function mutateAt(root: Record<string, unknown>, path: (string | number)[]) {
  let node = root as Record<string | number, unknown>;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  const last = path.at(-1)!;
  const v = node[last];
  if (typeof v === "number") node[last] = v + 1;
  else if (typeof v === "boolean") node[last] = !v;
  else if (v === null) node[last] = "tampered";
  else if (/^0x[0-9a-f]+$/i.test(String(v))) node[last] = `${String(v).slice(0, -1)}${String(v).endsWith("0") ? "1" : "0"}`;
  else if (/^\d+$/.test(String(v))) node[last] = `${v}1`;
  else node[last] = `${v}x`;
}

describe("JSON memo", () => {
  it("matches the required schema and field set", async () => {
    const { signed } = await cautionBundle();
    const memo = MemoSchema.parse(signed.memo);
    for (const key of ["memo_id", "token", "generated_at", "signed_at", "network", "verdict", "verdict_reason", "confidence", "coverage", "limitations", "checks", "checks_skipped", "cost", "disclaimer"]) {
      expect(memo).toHaveProperty(key);
    }
    for (const key of ["name", "intent", "miner_id", "finding", "status", "cost_usd", "signal_hash", "receipt_reference"]) {
      expect(memo.checks[0]).toHaveProperty(key);
    }
    for (const key of ["per_check_usd", "checks_paid", "total_usd"]) expect(memo.cost).toHaveProperty(key);
    expect(memo.generated_at).toBe("2026-11-06T07:44:30Z");
  });

  it("keeps the full contract address", async () => {
    const { signed } = await cautionBundle();
    expect(signed.memo.token.address).toBe("0x1234567890abcdef1234567890abcdef1234abcd");
  });

  it("rejects unknown fields", async () => {
    const { signed } = await cautionBundle();
    expect(() => MemoSchema.parse({ ...signed.memo, extra: 1 })).toThrow();
  });
});

describe("rendered memo", () => {
  it("shows the JSON values and abbreviates only the address", async () => {
    const { signed } = await cautionBundle();
    const { memo } = signed;
    const text = renderMemo(memo);
    expect(text).toContain(memo.memo_id);
    expect(text).toContain(`Token:     TEST  (0x1234...abcd)`);
    expect(text).toContain("Generated: 2026-11-06 07:44 UTC");
    expect(text).toContain(`VERDICT:   ${memo.verdict}   (confidence: ${memo.confidence})`);
    expect(squash(text)).toContain(squash(memo.verdict_reason));
    for (const c of memo.checks) {
      expect(squash(text)).toContain(squash(c.name));
      expect(text).toContain(c.miner_id!);
      expect(text).toContain("$0.01");
    }
    expect(squash(text)).toContain(squash(memo.disclaimer));
    for (const line of text.split("\n")) expect(line.length).toBeLessThanOrEqual(69);
  });

  it("follows the template sections in order", async () => {
    const text = renderMemo((await cautionBundle()).signed.memo);
    const order = ["TOKEN LISTING-RISK MEMO", "VERDICT:", "Reason:", "EVIDENCE", "Skipped:", "COST LINE", "Checks paid:", "Receipts: signal hashes in appendix.", "All requests on Telegraph testnet."];
    const positions = order.map((s) => text.indexOf(s));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("adapts to the number of checks and shows no empty rows", () => {
    const none = renderMemo(memoFrom([], [skippedCheck("Market price")]));
    expect(none).toContain("No evidence was successfully purchased.");
    expect(none).not.toContain("Source (intent)");
    const many = renderMemo(memoFrom(["A", "B", "C", "D", "E", "F"].map((n) => okCheck(`Check ${n}`, [clear(n)]))));
    expect(many).toContain("Checks paid: 6 x $0.01 = TOTAL $0.06 USDC");
  });

  it("breaks long intent names at underscores", () => {
    const check = { ...okCheck("Liquidity", [clear("l")]), intent: "LIQUIDITY_DEPTH_VERIFY_GENERAL" };
    const text = renderMemo(memoFrom([check]));
    expect(text).toContain("LIQUIDITY_DEPTH_");
    expect(text).toContain("VERIFY_GENERAL");
  });

  it("omits a miner id when unavailable", () => {
    const failed = { ...failedCheck("Holder count"), miner_id: null };
    const text = renderMemo(memoFrom([okCheck("Market price", [clear("price")]), failed]));
    expect(text).not.toContain("null");
    expect(text).not.toContain("undefined");
  });

  it("refuses to render a memo that fails its integrity rules", () => {
    const memo = clone(memoFrom([okCheck("Market price", [clear("price")])]));
    memo.verdict = "HIGH RISK";
    expect(() => renderMemo(memo)).toThrow(/Verdict/);
  });
});

describe("evidence integrity", () => {
  it("ties each successful row to a real paid request", async () => {
    const { signed, raw_evidence } = await cautionBundle();
    for (const c of signed.memo.checks.filter((x) => x.status === "ok")) {
      expect(c.payment?.status).toBe("confirmed");
      expect(c.receipt_reference).toBeTruthy();
      expect(c.payment!.tx_hash).toMatch(/^0x[0-9a-f]{64}$/);
      expect(raw_evidence.find((r) => r.check === c.name)).toBeDefined();
    }
  });

  it.each([
    ["no receipt", (c: Memo["checks"][0]) => { c.receipt_reference = null; }, /receipt/],
    ["unconfirmed payment", (c: Memo["checks"][0]) => { c.payment!.status = "unconfirmed"; }, /confirmed payment/],
    ["no payment", (c: Memo["checks"][0]) => { c.payment = null; }, /confirmed payment/],
    ["no raw response", (c: Memo["checks"][0]) => { c.raw_response_sha256 = null; }, /raw response/],
  ])("rejects a successful row with %s", (_label, corrupt, message) => {
    const check = okCheck("Market price", [clear("price")]);
    corrupt(check);
    expect(() => memoFrom([check])).toThrow(message);
  });

  it("allows a shared batch transaction but not a shared receipt", () => {
    const a = okCheck("A", [clear("a")]);
    const b = okCheck("B", [clear("b")]);
    b.payment!.tx_hash = a.payment!.tx_hash;
    expect(memoFrom([a, b]).cost.checks_paid).toBe(2);
    b.receipt_reference = a.receipt_reference;
    expect(() => memoFrom([a, b])).toThrow(/same receipt/);
  });

  it("prints key evidence on the memo and in the appendix", async () => {
    const signal = { ...soft("reputation", "Recent adverse media needs review"), details: ['"Token hacked" (example.com, 2 Nov)'] };
    const bundle = await bundleFrom([okCheck("Adverse media", [signal])]);
    expect(renderMemo(bundle.signed.memo)).toContain('- "Token hacked" (example.com, 2 Nov)');
    expect(renderAppendix(bundle)).toContain('evidence: "Token hacked" (example.com, 2 Nov)');
  });

  it("detects a stored signal that no longer matches its signed hash", async () => {
    const bundle = clone(await cautionBundle());
    bundle.raw_evidence[1]!.signal = { payload: { answer: "forged" } };
    expect((await verifyBundle(bundle)).errors.join()).toMatch(/Stored signal/);
  });

  it("does not count a second source as an extra planned check", () => {
    const memo = memoFrom([okCheck("Adverse media", [inconclusiveSignal("r")]), okCheck("Adverse media (second source)", [inconclusiveSignal("r")])], [skippedCheck("X")]);
    expect(memo.coverage).toEqual({ planned: 2, executed: 1 });
  });

  it("does not claim a purchase when nothing was bought", () => {
    expect(memoFrom([failedCheck("A")]).disclaimer).toBe("Testnet run. No intelligence was purchased. Not financial advice.");
    expect(memoFrom([okCheck("A", [clear("a")])]).disclaimer).toContain("Intelligence bought via Telegraph");
  });

  it("rejects a failed check that claims a finding", () => {
    expect(() => memoFrom([{ ...failedCheck("Holder count"), finding: "looks fine" }])).toThrow(/finding/);
  });

  it("keeps an unavailable signal hash visible rather than inventing one", async () => {
    const bundle = await bundleFrom([okCheck("Market price", [clear("price")], { signalHash: null })]);
    const c = bundle.signed.memo.checks[0]!;
    expect(c.signal_hash).toBeNull();
    expect(c.signal_hash_status).toBe("unavailable");
    expect(c.receipt_reference).not.toBeNull();
    expect(renderAppendix(bundle)).toContain("signal_hash: unavailable");
  });

  it("distinguishes failed from skipped checks", () => {
    const text = renderMemo(memoFrom([okCheck("Market price", [clear("price")]), failedCheck("Holder count")], [skippedCheck("Contract audit")]));
    expect(text).toContain("Failed: Holder count (Miner returned HTTP 500)");
    expect(text).toContain("Skipped: Contract audit (No live miner for this intent.)");
  });

  it("shortens long failure messages on the memo but keeps them whole in the appendix", async () => {
    const reason = `Payment client error: ${"very long detail ".repeat(20)}`.trim();
    const bundle = await bundleFrom([failedCheck("Holder count", reason)]);
    expect(renderMemo(bundle.signed.memo)).toContain("see appendix");
    expect(squash(renderAppendix(bundle))).toContain(squash(reason));
  });

  it("shows the reason for every skipped check in both outputs", async () => {
    const bundle = await bundleFrom([okCheck("Market price", [clear("price")])], [skippedCheck("Contract audit"), skippedCheck("Holder count", "No live miner covers chain ethereum-sepolia.")]);
    const memoText = renderMemo(bundle.signed.memo);
    const appendix = renderAppendix(bundle);
    for (const s of bundle.signed.memo.checks_skipped) {
      expect(squash(memoText)).toContain(squash(s.reason));
      expect(appendix).toContain(`Reason: ${s.reason}`);
    }
  });
});

describe("cost line", () => {
  it("sums confirmed receipts", () => {
    const memo = memoFrom(["A", "B", "C"].map((n) => okCheck(n, [clear(n)])));
    expect(memo.cost).toMatchObject({ checks_paid: 3, total_usd: 0.03, per_check_usd: 0.01, currency: "USDC" });
    expect(memo.cost.totals[0]).toMatchObject({ amount_atomic: "30000", amount: "0.03" });
    expect(renderMemo(memo)).toContain("Checks paid: 3 x $0.01 = TOTAL $0.03 USDC");
  });

  it("avoids floating-point drift", () => {
    const memo = memoFrom(["A", "B", "C"].map((n) => okCheck(n, [clear(n)], { atomic: "100000" })));
    expect(memo.cost.total_usd).toBe(0.3);
  });

  it("totals different prices from their individual receipts", () => {
    const memo = memoFrom([okCheck("A", [clear("a")], { atomic: "10000" }), okCheck("B", [clear("b")], { atomic: "20000" })]);
    expect(memo.cost.per_check_usd).toBeNull();
    expect(memo.cost.total_usd).toBe(0.03);
    expect(renderMemo(memo)).toContain("Checks paid: 2 = $0.01 + $0.02 = TOTAL $0.03 USDC");
  });

  it("gives no USD value without a verified conversion", () => {
    const memo = memoFrom([okCheck("A", [clear("a")], { atomic: "5000000000000000", currency: "WETH", decimals: 18 })]);
    expect(memo.checks[0]!.cost_usd).toBeNull();
    expect(memo.cost.total_usd).toBeNull();
    expect(memo.cost.usd_basis).toBeNull();
    const text = renderMemo(memo);
    expect(text).toContain("TOTAL 0.005 WETH");
    expect(text).not.toContain("$");
  });

  it("does not merge different currencies into one total", () => {
    const memo = memoFrom([okCheck("A", [clear("a")]), okCheck("B", [clear("b")], { atomic: "1000000", currency: "DAI", decimals: 6 })]);
    expect(memo.cost.totals.map((t) => t.currency)).toEqual(["DAI", "USDC"]);
    expect(memo.cost.total_usd).toBeNull();
  });

  it("excludes failed, unconfirmed and skipped checks", () => {
    const unconfirmed = { ...failedCheck("B", "No settlement record"), status: "unconfirmed" as const };
    const memo = memoFrom([okCheck("A", [clear("a")]), failedCheck("C"), unconfirmed], [skippedCheck("D")]);
    expect(memo.cost.checks_paid).toBe(1);
    expect(memo.cost.total_usd).toBe(0.01);
    expect(memo.cost.failed_attempts).toBe(2);
  });

  it("reports money spent on a failed attempt separately", () => {
    const paidButFailed = { ...okCheck("B", []), status: "failed" as const, finding: null, failure_reason: "Miner returned HTTP 500" };
    const memo = memoFrom([okCheck("A", [clear("a")]), paidButFailed]);
    expect(memo.cost.total_usd).toBe(0.01);
    expect(memo.cost.failed_attempt_spend[0]).toMatchObject({ currency: "USDC", amount_atomic: "10000" });
    expect(renderMemo(memo)).toContain("Settled on failed attempts: 0.01 USDC (not in total; Telegraph");
  });

  it("never treats a quote as spending", () => {
    const check = failedCheck("A");
    check.status = "unconfirmed";
    check.payment = { ...okCheck("X", []).payment!, status: "unconfirmed", amount_atomic: null, amount: null, decimals: null, currency: null, tx_hash: null, payer: null, block_number: null };
    const memo = memoFrom([check]);
    expect(memo.cost.checks_paid).toBe(0);
    expect(renderMemo(memo)).toContain("Checks paid: 0 = TOTAL 0");
  });

  it("detects altered arithmetic independently of the calculator", () => {
    const memo = clone(memoFrom([okCheck("A", [clear("a")])]));
    memo.cost.totals[0]!.amount_atomic = "99999";
    const errors = findIntegrityViolations(memo);
    expect(errors).toContain("USDC total does not equal the sum of its receipts");
    expect(errors).toContain("Cost section does not match the confirmed receipts");
  });
});

describe("verdict", () => {
  it("hard red flag gives HIGH RISK", () => {
    expect(memoFrom([okCheck("Fraud screen", [hard("reputation")]), okCheck("Market price", [clear("price")])]).verdict).toBe("HIGH RISK");
  });

  it("soft negatives give CAUTION", () => {
    expect(memoFrom([okCheck("Adverse media", [soft("reputation")]), okCheck("Market price", [clear("price")])]).verdict).toBe("CAUTION");
  });

  it("CLEAR requires every check to succeed with clear evidence", () => {
    const memo = memoFrom([okCheck("Market price", [clear("price")]), okCheck("Liquidity", [clear("liquidity")])]);
    expect(memo.verdict).toBe("CLEAR");
    expect(memo.verdict_reason).toContain("not a guarantee of safety");
  });

  it.each([
    ["no checks at all", [], []],
    ["a skipped check", [okCheck("A", [clear("a")])], [skippedCheck("B")]],
    ["a failed check", [okCheck("A", [clear("a")]), failedCheck("B")], []],
    ["only failures", [failedCheck("A")], []],
    ["an inconclusive result", [okCheck("A", [clear("a")]), okCheck("B", [inconclusiveSignal("b")])], []],
    ["everything skipped", [], [skippedCheck("A"), skippedCheck("B")]],
  ])("missing evidence cannot produce CLEAR: %s", (_label, checks, skipped) => {
    expect(memoFrom(checks, skipped).verdict).toBe("CAUTION");
  });

  it("conflicting sources cannot produce CLEAR", () => {
    const memo = memoFrom([okCheck("Fraud screen", [clear("reputation")]), okCheck("Adverse media", [soft("reputation")])]);
    expect(memo.verdict).toBe("CAUTION");
    expect(memo.verdict_reason).toContain("Sources conflict on: reputation");
  });

  it("a hard flag is not suppressed by a clean source", () => {
    expect(memoFrom([okCheck("A", [clear("reputation")]), okCheck("B", [hard("reputation")])]).verdict).toBe("HIGH RISK");
  });

  it("a soft-only news hit is not a confirmed match", () => {
    expect(memoFrom([okCheck("Adverse media", [soft("reputation", "Article mentions sanctions")])]).verdict).toBe("CAUTION");
  });
});

describe("confidence", () => {
  it("two or more skipped checks force low", () => {
    const memo = memoFrom(["A", "B", "C", "D"].map((n) => okCheck(n, [clear(n)])), [skippedCheck("E"), skippedCheck("F")]);
    expect(memo.confidence).toBe("low");
  });

  it("one skipped check is medium", () => {
    expect(memoFrom([okCheck("A", [clear("a")]), okCheck("B", [clear("b")])], [skippedCheck("C")]).confidence).toBe("medium");
  });

  it("complete consistent evidence is high", () => {
    expect(memoFrom([okCheck("A", [clear("a")]), okCheck("B", [clear("b")])]).confidence).toBe("high");
  });

  it("no evidence is low", () => {
    expect(memoFrom([failedCheck("A")]).confidence).toBe("low");
  });

  it("stays independent of the verdict: HIGH RISK can be low confidence", () => {
    const memo = memoFrom([okCheck("Fraud screen", [hard("reputation")])], [skippedCheck("B"), skippedCheck("C")]);
    expect(memo.verdict).toBe("HIGH RISK");
    expect(memo.confidence).toBe("low");
  });
});

describe("appendix", () => {
  it("has the required structure and real values", async () => {
    const bundle = await cautionBundle();
    const text = renderAppendix(bundle);
    const { memo, memo_hash, signer_address } = bundle.signed;
    expect(text).toContain("APPENDIX: RAW RECEIPTS");
    expect(text).toContain(`Assessment ID: ${memo.memo_id}`);
    expect(text).toContain("Network: Ethereum Sepolia Testnet");
    for (const c of memo.checks) {
      expect(text).toContain(`Check: ${c.name}`);
      expect(text).toContain(`intent: ${c.intent}`);
      expect(text).toContain(`miner_id: ${c.miner_id}`);
      expect(text).toContain("payment_currency: USDC");
      expect(squash(text)).toContain(squash(`receipt_reference: ${c.receipt_reference}`));
    }
    expect(text).toContain("TOTAL CONFIRMED SPENDING: 0.02 USDC");
    expect(squash(text)).toContain(squash(`MEMO HASH: ${memo_hash}`));
    expect(squash(text)).toContain(squash(`SIGNER ADDRESS: ${signer_address}`));
    expect(squash(text)).toContain(squash(`SIGNATURE: ${bundle.signed.signature}`));
  });

  it("keeps receipt references and hashes on one line for copying", async () => {
    const bundle = await cautionBundle();
    const lines = renderAppendix(bundle).split("\n");
    expect(lines).toContain(`MEMO HASH: ${bundle.signed.memo_hash}`);
    for (const c of bundle.signed.memo.checks) expect(lines).toContain(`receipt_reference: ${c.receipt_reference}`);
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(104);
  });

  it("keeps JSON results readable, one field per line", async () => {
    const bundle = await bundleFrom([okCheck("Market price", [clear("price")])]);
    expect(renderAppendix(bundle)).toContain('{\n  "fixture": "Market price"\n}');
  });

  it("shortens long results only in the appendix, and says so", async () => {
    const bundle = await cautionBundle();
    const huge = { ...bundle, raw_evidence: bundle.raw_evidence.map((r) => ({ ...r, body_base64: Buffer.from("x".repeat(9000)).toString("base64") })) };
    expect(squash(renderAppendix(huge))).toContain(squash("The evidence bundle holds the complete response."));
    expect(EvidenceBundleSchema.parse(huge).raw_evidence[0]!.body_base64).toHaveLength(12000);
  });
});

describe("PDF", () => {
  it("includes the complete cost line on the first page", async () => {
    const bundle = await cautionBundle();
    const pages = await pdfPages(await renderPdf(bundle));
    expect(pages[0]).toContain("Checks paid: 2 x $0.01 = TOTAL $0.02 USDC");
    expect(pages[0]).toContain("TOKEN LISTING-RISK MEMO");
    expect(pages[0]).not.toContain("APPENDIX: RAW RECEIPTS");
  });

  it("includes the evidence appendix with its signature", async () => {
    const bundle = await cautionBundle();
    const pages = await pdfPages(await renderPdf(bundle));
    const rest = squash(pages.slice(1).join("\n"));
    expect(pages[1]).toContain("APPENDIX: RAW RECEIPTS");
    expect(rest).toContain(squash(`MEMO HASH: ${bundle.signed.memo_hash}`));
    expect(rest).toContain(squash(`SIGNATURE: ${bundle.signed.signature}`));
    for (const c of bundle.signed.memo.checks) expect(rest).toContain(squash(`Check: ${c.name}`));
    for (const s of bundle.signed.memo.checks_skipped) expect(rest).toContain(squash(s.reason));
  });

  it("carries the memo text unchanged", async () => {
    const bundle = await cautionBundle();
    const [first] = await pdfPages(await renderPdf(bundle));
    expect(squash(first!)).toBe(squash(renderMemo(bundle.signed.memo)));
  });

  it("keeps a heavy memo on one page and sends the rest to the appendix", async () => {
    const checks = Array.from({ length: 12 }, (_, i) => okCheck(`Check number ${i}`, [soft(`topic${i}`, `Concern number ${i} needs review`)]));
    const pages = await pdfPages(await renderPdf(await bundleFrom(checks)));
    expect(pages[0]).toContain("COST LINE");
    expect(pages[0]).toContain("Checks paid: 12");
    expect(pages[1]).toContain("APPENDIX: RAW RECEIPTS");
  });

  it("survives text outside the PDF font's range", async () => {
    const bundle = await cautionBundle();
    bundle.raw_evidence[0]!.body_base64 = Buffer.from(JSON.stringify({ text: "漢字 😀" })).toString("base64");
    await expect(renderPdf(bundle)).resolves.toBeInstanceOf(Buffer);
  });
});

describe("hashing and signing", () => {
  it("canonical form ignores key order but not values", () => {
    expect(canonicalize({ b: 1, a: [true, null, "x"] })).toBe('{"a":[true,null,"x"],"b":1}');
    expect(canonicalize({ a: 1, b: 2 })).toBe(canonicalize({ b: 2, a: 1 }));
    expect(() => canonicalize({ a: undefined })).toThrow();
    expect(() => canonicalize({ a: Infinity })).toThrow();
  });

  it("memo hash matches the canonical serialization", async () => {
    const { signed } = await cautionBundle();
    expect(signed.memo_hash).toBe(sha256(toBytes(canonicalize(signed.memo))));
    expect(hashMemo(signed.memo)).toBe(signed.memo_hash);
  });

  it("is stable after a JSON round trip with shuffled keys", async () => {
    const { signed } = await cautionBundle();
    const shuffled = Object.fromEntries(Object.entries(clone(signed.memo)).reverse()) as Memo;
    expect(hashMemo(shuffled)).toBe(signed.memo_hash);
  });

  it("verification succeeds for an unchanged memo", async () => {
    const bundle = await cautionBundle();
    const result = await verifySignedMemo(clone(bundle.signed), TEST_SIGNER.address);
    expect(result).toMatchObject({ valid: true, errors: [], recovered_signer: TEST_SIGNER.address });
    expect((await verifyBundle(clone(bundle))).valid).toBe(true);
  });

  it("verification fails after any single signed field changes", async () => {
    const bundle = await bundleFrom(
      [okCheck("Market price", [clear("price")]), okCheck("Adverse media", [soft("reputation")], { signalHash: null }), failedCheck("Holder count")],
      [skippedCheck("Contract audit")],
    );
    const paths = leafPaths(bundle.signed.memo);
    expect(paths.length).toBeGreaterThan(60);
    for (const path of paths) {
      const copy = clone(bundle.signed);
      mutateAt(copy.memo as unknown as Record<string, unknown>, path);
      const result = await verifySignedMemo(copy);
      expect(result.valid, `tampering with ${path.join(".")} went undetected`).toBe(false);
    }
  });

  it("verification fails when the hash and memo are both swapped but not re-signed", async () => {
    const { signed } = await cautionBundle();
    const copy = clone(signed);
    copy.memo.token.symbol = "EVIL";
    copy.memo_hash = hashMemo(copy.memo);
    const result = await verifySignedMemo(copy);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Signature was not produced by the stated signer");
  });

  it("a re-signed forgery fails against the pinned signer", async () => {
    const { privateKeyToAccount } = await import("viem/accounts");
    const attacker = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    const forged = await signMemo(memoFrom([okCheck("Market price", [clear("price")])]), attacker);
    expect((await verifySignedMemo(forged)).valid).toBe(true);
    expect((await verifySignedMemo(forged, TEST_SIGNER.address)).valid).toBe(false);
  });

  it("detects a raw response that no longer matches its signed hash", async () => {
    const bundle = clone(await cautionBundle());
    bundle.raw_evidence[0]!.body_base64 = Buffer.from('{"forged":true}').toString("base64");
    const result = await verifyBundle(bundle);
    expect(result.valid).toBe(false);
    expect(result.errors.join()).toMatch(/does not match its signed hash/);
  });

  it("refuses to sign an invalid memo", async () => {
    const memo = clone(memoFrom([okCheck("A", [clear("a")])]));
    memo.confidence = "low";
    await expect(signMemo(memo, TEST_SIGNER)).rejects.toThrow(/Confidence/);
  });

  it("a correction is a new version that points at the old hash", async () => {
    const { signed } = await cautionBundle();
    const corrected = await issueCorrection(signed, { token: { ...signed.memo.token, symbol: "FIXED" } }, TEST_SIGNER);
    expect(corrected.memo.version).toBe(2);
    expect(corrected.memo.supersedes).toBe(signed.memo_hash);
    expect(corrected.memo_hash).not.toBe(signed.memo_hash);
    expect((await verifySignedMemo(corrected)).valid).toBe(true);
    expect((await verifySignedMemo(signed)).valid).toBe(true);
    expect(renderMemo(corrected.memo)).toContain("v2");
  });
});

describe("validation", () => {
  it("assertValidMemo accepts assembled output", () => {
    const memo = memoFrom([okCheck("A", [clear("a")])]);
    expect(assertValidMemo(memo)).toEqual(memo);
  });

  it("the cost is derived, never supplied", () => {
    const check = okCheck("A", [clear("a")]);
    expect(computeCost([check]).total_usd).toBe(0.01);
  });
});
