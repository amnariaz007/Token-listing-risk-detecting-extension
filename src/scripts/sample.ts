import { mkdirSync, writeFileSync } from "node:fs";
import { renderAppendix } from "../lib/memo/appendix.ts";
import { renderPdf } from "../lib/memo/pdf.ts";
import { renderMemo } from "../lib/memo/render.ts";
import { bundleFrom, clear, okCheck, skippedCheck, soft } from "../../test/fixtures.ts";

// Writes a clearly labelled synthetic memo, to preview the format without spending anything.
const bundle = await bundleFrom(
  [
    okCheck("Market price", [clear("price")], { finding: "$0.0123", result: { synthetic: true, price_usd: 0.0123 } }),
    okCheck("Adverse media", [soft("reputation", "Recent adverse media needs review")], { finding: "2 adverse mention(s)", result: { synthetic: true } }),
  ],
  [skippedCheck("Contract audit")],
  {
    memoId: "LRM-2026-SMPL",
    token: { name: "Sample Token", symbol: "SAMPLE", address: "0x1234567890abcdef1234567890abcdef1234abcd", chain: "ethereum-sepolia", identity_source: "onchain" },
    disclaimer: "SYNTHETIC SAMPLE. No purchases were made and every receipt here is fake. Not financial advice.",
  },
);
mkdirSync("examples", { recursive: true });
writeFileSync("examples/sample-memo.txt", renderMemo(bundle.signed.memo));
writeFileSync("examples/sample-appendix.txt", renderAppendix(bundle));
writeFileSync("examples/sample-bundle.json", JSON.stringify(bundle, null, 2));
writeFileSync("examples/sample-memo.pdf", await renderPdf(bundle));
console.log(renderMemo(bundle.signed.memo));
