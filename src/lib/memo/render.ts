import type { Check, Memo } from "./schema.ts";
import { assertValidMemo } from "./validate.ts";

export const MEMO_WIDTH = 69;
const HEAVY = "=".repeat(MEMO_WIDTH);
const LIGHT = "-".repeat(MEMO_WIDTH);

/** Word-wraps text, hard-breaking anything longer than the width (intents, hashes). */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    let word = raw;
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = "";
    }
    while (word.length > width) {
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.length > 0 ? lines : [""];
}

const shortAddress = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;
const utcStamp = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
const isTestnetChain = (chain: string) => /sepolia|testnet|goerli|holesky|amoy/i.test(chain);

export function formatUsd(value: number): string {
  const text = value.toFixed(6).replace(/0+$/, "");
  const [whole, fraction = ""] = text.split(".");
  return `$${whole}.${fraction.padEnd(2, "0")}`;
}

function formatCheckCost(c: Check): string {
  if (c.cost_usd !== null) return formatUsd(c.cost_usd);
  return c.payment ? `${c.payment.amount} ${c.payment.currency}` : "";
}

/** Breaks long identifiers after an underscore, so intent names stay readable. */
function wrapCell(cell: string, width: number): string[] {
  if (/\s/.test(cell) || !cell.includes("_") || cell.length <= width) return wrap(cell, width);
  const lines: string[] = [];
  let line = "";
  for (const part of cell.split(/(?<=_)/)) {
    if (line && line.length + part.length > width) {
      lines.push(line);
      line = "";
    }
    line += part;
  }
  if (line) lines.push(line);
  return lines.flatMap((l) => wrap(l, width));
}

function table(rows: string[][], widths: number[]): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const cells = row.map((cell, i) => wrapCell(cell, widths[i]!));
    const height = Math.max(...cells.map((c) => c.length));
    for (let n = 0; n < height; n++) {
      out.push(cells.map((c, i) => (c[n] ?? "").padEnd(widths[i]!)).join(" ").trimEnd());
    }
  }
  return out;
}

function costLine(memo: Memo): string {
  const { cost } = memo;
  if (cost.checks_paid === 0) return "Checks paid: 0 = TOTAL 0 (no confirmed purchases)";
  const total = cost.totals.map((t) => (cost.total_usd !== null ? `${formatUsd(cost.total_usd)} ${t.currency}` : `${t.amount} ${t.currency}`)).join(" + ");
  const prefix = `Checks paid: ${cost.checks_paid}`;
  if (cost.per_check_usd !== null) return `${prefix} x ${formatUsd(cost.per_check_usd)} = TOTAL ${total}`;
  const items = cost.line_items.map((l) => (l.cost_usd !== null ? formatUsd(l.cost_usd) : `${l.amount} ${l.currency}`)).join(" + ");
  return `${prefix} = ${items} = TOTAL ${total}`;
}

/** The one-page memo. Takes only the canonical object and invents nothing beyond its fields. */
export function renderMemo(input: Memo): string {
  const memo = assertValidMemo(input);
  const title = "TOKEN LISTING-RISK MEMO";
  const id = memo.version > 1 ? `${memo.memo_id} v${memo.version}` : memo.memo_id;
  const lines: string[] = [`${title}${id.padStart(MEMO_WIDTH - title.length)}`, HEAVY, ""];

  const label = memo.token.name ? `${memo.token.name} / ${memo.token.symbol}` : memo.token.symbol;
  lines.push(`Token:     ${label}  (${memo.token.address ? shortAddress(memo.token.address) : "contract not resolved"})`);
  lines.push(`Chain:     ${memo.token.chain}${isTestnetChain(memo.token.chain) ? " (testnet)" : ""}`);
  if (memo.token.chain !== memo.payment_network) lines.push(`Paid on:   ${memo.payment_network} (${memo.network})`);
  lines.push(`Generated: ${utcStamp(memo.generated_at)}`);
  if (memo.supersedes) lines.push(...wrap(`Corrects:  ${memo.supersedes}`, MEMO_WIDTH));
  lines.push("", `VERDICT:   ${memo.verdict}   (confidence: ${memo.confidence})`);
  lines.push(`Coverage:  ${memo.coverage.executed} of ${memo.coverage.planned} planned checks executed`, "");

  wrap(memo.verdict_reason, MEMO_WIDTH - 11).forEach((text, i) => {
    lines.push(`${i === 0 ? "Reason:    " : "           "}${text}`);
  });

  lines.push("", LIGHT, "EVIDENCE", LIGHT, "");
  const ok = memo.checks.filter((c) => c.status === "ok");
  if (ok.length > 0) {
    const rows = [["Check", "Source (intent)", "Miner", "Finding", "Cost", "Tier"]];
    for (const c of ok) rows.push([c.name, c.intent, c.miner_id ?? "", c.finding ?? "", formatCheckCost(c), c.tier === undefined ? "" : `T${c.tier}`]);
    lines.push(...table(rows, [12, 16, 8, 17, 7, 4]));
  } else {
    lines.push("No evidence was successfully purchased.");
  }

  const details = memo.checks.flatMap((c) => c.signals.flatMap((s) => s.details ?? [])).slice(0, 3);
  if (details.length > 0) lines.push("", "Key evidence:");
  for (const detail of details) {
    const short = detail.length > 120 ? `${detail.slice(0, 117)}...` : detail;
    wrap(short, MEMO_WIDTH - 2).forEach((text, i) => lines.push(`${i === 0 ? "- " : "  "}${text}`));
  }

  // Long technical messages are shortened here only. The appendix keeps them whole.
  const brief = (reason: string | null) => (reason && reason.length > 80 ? `${reason.slice(0, 77)}... see appendix` : reason);
  const notes = [
    ...memo.checks.filter((c) => c.status === "failed").map((c) => `Failed: ${c.name} (${brief(c.failure_reason)})`),
    ...memo.checks.filter((c) => c.status === "unconfirmed").map((c) => `Unconfirmed, not counted: ${c.name} (${brief(c.failure_reason)})`),
    ...memo.checks_skipped.map((c) => `Skipped: ${c.name} (${c.reason})`),
  ];
  if (notes.length + memo.limitations.length > 0) lines.push("");
  for (const note of [...notes, ...memo.limitations.map((l) => `Limitation: ${l}`)]) lines.push(...wrap(note, MEMO_WIDTH));

  lines.push("", LIGHT, "COST LINE", LIGHT, "");
  lines.push(...wrap(costLine(memo), MEMO_WIDTH));
  for (const spend of memo.cost.failed_attempt_spend) {
    lines.push(...wrap(`Settled on failed attempts: ${spend.amount} ${spend.currency} (not in total; Telegraph credits it to escrow)`, MEMO_WIDTH));
  }
  lines.push("", "Receipts: signal hashes in appendix.", `All requests on Telegraph ${memo.network}.`, "");
  lines.push(...wrap(memo.disclaimer, MEMO_WIDTH), "", HEAVY);
  return lines.join("\n");
}
