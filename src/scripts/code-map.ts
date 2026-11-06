import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Regenerates docs/CODE_MAP.md by reading the source, so the function list cannot drift from the code.
const WHERE_TO_CHANGE: [string, string][] = [
  ["Which checks the agent buys, their order, wording and preferred miners", "`src/lib/agent/planner.ts` (`CANDIDATES`)"],
  ["How a miner's answer becomes a finding", "`src/lib/agent/interpret.ts`"],
  ["Thresholds for HIGH RISK, such as the sanctions score", "`src/lib/agent/interpret.ts`"],
  ["The rules for CLEAR, CAUTION, HIGH RISK and confidence", "`src/lib/memo/verdict.ts`"],
  ["Which token inputs are accepted (symbol, address)", "`src/lib/agent/input.ts`"],
  ["Which chains a token can be on", "`src/config/protocol.ts` (`TOKEN_CHAINS`)"],
  ["Per-check tier values", "`src/lib/agent/planner.ts` (`tier`), `src/lib/agent/executor.ts` (`tierOf`)"],
  ["Batch ranking and budget", "`src/lib/agent/batch.ts`"],
  ["The browser extension", "`extension/` (`lib.js` for page parsing, `content.js` for the panel)"],
  ["Who may start a paid run", "`src/lib/agent/guard.ts`"],
  ["The order of the run, the second-source rule, and live log messages", "`src/lib/agent/orchestrator.ts`"],
  ["When a payment counts as confirmed", "`src/lib/agent/executor.ts`, `src/lib/blockchain/verifier.ts`"],
  ["Which payments are refused before signing", "`src/lib/telegraph/payments.ts`"],
  ["Budget and request limits", "`src/config/protocol.ts`, `.env`"],
  ["Network, token and contract addresses", "`src/config/protocol.ts`"],
  ["Telegraph API calls", "`src/lib/telegraph/client.ts`, `src/lib/telegraph/discovery.ts`"],
  ["Memo fields (the JSON format)", "`src/lib/memo/schema.ts`, then `assemble.ts` and `validate.ts`"],
  ["How the memo text looks", "`src/lib/memo/render.ts`"],
  ["The appendix", "`src/lib/memo/appendix.ts`"],
  ["PDF layout", "`src/lib/memo/pdf.ts`"],
  ["How memos are signed and verified", "`src/lib/memo/sign.ts`, `src/lib/memo/verify.ts`"],
  ["Which files each run saves", "`src/lib/storage/assessments.ts`"],
  ["A screen", "See Screens below"],
  ["Colors and fonts", "`src/app/globals.css`"],
];

const SCREENS: [string, string, string][] = [
  ["Dashboard", "/", "src/app/page.tsx"],
  ["New assessment", "/assessments/new", "src/app/assessments/new/page.tsx"],
  ["Agent execution", "/runs/[runId]", "src/app/runs/[runId]/page.tsx"],
  ["Results", "/assessments/[id]", "src/app/assessments/[id]/page.tsx"],
  ["Evidence explorer", "/assessments/[id]/evidence", "src/app/assessments/[id]/evidence/page.tsx"],
  ["Memo viewer", "/assessments/[id]/memo", "src/app/assessments/[id]/memo/page.tsx"],
  ["Watchlist input", "/batches/new", "src/app/batches/new/page.tsx"],
  ["Watchlist ranking", "/batches/[id]", "src/app/batches/[id]/page.tsx"],
];

const COMMANDS: [string, string][] = [
  ["npm run dev", "Start the app in development mode"],
  ["npm run build, then npm start", "Start the production app"],
  ["npm test", "Simulated tests, with no network or spending"],
  ["npm run test:live", "Real node, with no spending"],
  ["npm run test:paid", "Real node, spends test USDC"],
  ["npm run wallet", "Create or show the burner wallet"],
  ["npm run fund", "Mint 10 test USDC"],
  ["npm run first-purchase", "One real paid request"],
  ["npm run assess -- <address or symbol> [chain]", "A full assessment from the terminal, spends test USDC"],
  ["npm run verify -- <bundle.json> --onchain", "Check a memo independently"],
  ["npm run discover", "Regenerate the capability report"],
  ["npm run code-map", "Regenerate this file"],
  ["npm run sample", "Write the synthetic sample memo"],
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(tsx?|js)$/.test(name) ? [path] : [];
  });
}

type Entry = { name: string; exported: boolean; note: string };

function describeAbove(lines: string[], index: number): string {
  let i = index - 1;
  while (i >= 0 && lines[i]!.trim() === "") i--;
  const line = lines[i]?.trim() ?? "";
  if (line.startsWith("//")) return line.replace(/^\/\/\s?/, "");
  if (!line.endsWith("*/")) return "";
  const collected: string[] = [];
  for (; i >= 0; i--) {
    const text = lines[i]!.trim();
    const clean = text.replace(/^\/\*\*?\s?/, "").replace(/\*\/$/, "").replace(/^\*\s?/, "").trim();
    if (clean) collected.unshift(clean);
    if (text.startsWith("/*")) break;
  }
  return collected.join(" ");
}

function parse(file: string): Entry[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const entries: Entry[] = [];
  const pattern = /^(export\s+)?(?:default\s+)?(?:async\s+)?(?:function\s+(\w+)|class\s+(\w+)|const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|<|\w+\s*=>))/;
  lines.forEach((line, i) => {
    const m = line.match(pattern);
    const name = m?.[2] ?? m?.[3] ?? m?.[4];
    if (name) entries.push({ name, exported: Boolean(m?.[1]), note: describeAbove(lines, i) });
  });
  return entries;
}

const escape = (s: string) => s.replace(/\|/g, "\\|");

const sections: [string, string][] = [
  ["Configuration", "src/config"],
  ["Telegraph protocol", "src/lib/telegraph"],
  ["Agent", "src/lib/agent"],
  ["Blockchain", "src/lib/blockchain"],
  ["Memo", "src/lib/memo"],
  ["Storage", "src/lib/storage"],
  ["Screens and API routes", "src/app"],
  ["Shared UI components", "src/components"],
  ["Command-line scripts", "src/scripts"],
  ["Browser extension", "extension"],
];

let out = `# Code map

Everything built in this project, and where to change it.

Generated by \`npm run code-map\`. Edit \`src/scripts/code-map.ts\` to change the fixed tables, and regenerate this file after changing code. For why things work this way, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Where to change what

| To change | Edit |
|---|---|
${WHERE_TO_CHANGE.map(([a, b]) => `| ${a} | ${b} |`).join("\n")}

## Screens

| Screen | Address | File |
|---|---|---|
${SCREENS.map(([a, b, c]) => `| ${a} | \`${b}\` | \`${c}\` |`).join("\n")}

## Commands

| Command | What it does |
|---|---|
${COMMANDS.map(([a, b]) => `| \`${a}\` | ${b} |`).join("\n")}

## Every file and function

Functions marked **(internal)** are used only inside their own file.
`;

for (const [title, dir] of sections) {
  out += `\n### ${title}\n`;
  for (const file of walk(dir).sort()) {
    const entries = parse(file);
    out += `\n**\`${file}\`**\n\n`;
    if (entries.length === 0) {
      out += "No named functions.\n";
      continue;
    }
    out += "| Function | Description |\n|---|---|\n";
    for (const e of entries) out += `| \`${e.name}\`${e.exported ? "" : " **(internal)**"} | ${escape(e.note)} |\n`;
  }
}

out += `\n## Tests\n\n| File | Network | Spends? |\n|---|---|---|\n| \`test/memo.test.ts\` | None | No |\n| \`test/agent.test.ts\` | None: simulated node, real x402 library | No |\n| \`test/live/free.live.test.ts\` | Real node and Sepolia | No |\n| \`test/live/paid.live.test.ts\` | Real node and Sepolia | **Yes** |\n| \`test/fixtures.ts\` | Synthetic test data, used by the simulated tests and \`npm run sample\` | No |\n`;
writeFileSync("docs/CODE_MAP.md", out);
console.log(`Wrote docs/CODE_MAP.md (${out.split("\n").length} lines)`);
