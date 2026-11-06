import type { Check, Memo, SkippedCheck } from "./schema.ts";

export type Verdict = Memo["verdict"];
export type Confidence = Memo["confidence"];

type Evidence = { checks: Check[]; checks_skipped: SkippedCheck[] };

/** Topics on which executed sources disagree: one reports clear, another reports a problem. */
export function findConflicts(checks: Check[]): string[] {
  const seen = new Map<string, Set<string>>();
  for (const check of checks.filter((c) => c.status === "ok")) {
    for (const signal of check.signals) {
      if (!seen.has(signal.topic)) seen.set(signal.topic, new Set());
      seen.get(signal.topic)!.add(signal.level);
    }
  }
  return [...seen.entries()]
    .filter(([, levels]) => levels.has("clear") && (levels.has("soft") || levels.has("hard")))
    .map(([topic]) => topic)
    .sort();
}

const signalsAt = (checks: Check[], level: string) =>
  checks.filter((c) => c.status === "ok").flatMap((c) => c.signals.filter((s) => s.level === level));

/** A second source is another paid request for the same check, so it is not counted as an extra planned check. */
export function computeCoverage(checks: Check[], skipped: SkippedCheck[]): Memo["coverage"] {
  const base = (name: string) => name.replace(/ \(second source\)$/, "");
  const planned = new Set(checks.map((c) => base(c.name)));
  const executed = new Set(checks.filter((c) => c.status === "ok").map((c) => base(c.name)));
  return { planned: planned.size + skipped.length, executed: executed.size };
}

export function computeVerdict({ checks, checks_skipped }: Evidence): Verdict {
  if (signalsAt(checks, "hard").length > 0) return "HIGH RISK";

  const executed = checks.filter((c) => c.status === "ok");
  const defensibleClear =
    executed.length > 0 &&
    executed.length === checks.length &&
    checks_skipped.length === 0 &&
    executed.every((c) => c.signals.length > 0 && c.signals.every((s) => s.level === "clear" || s.level === "superseded")) &&
    findConflicts(checks).length === 0;

  return defensibleClear ? "CLEAR" : "CAUTION";
}

/** Independent of the verdict: a verified red flag stays HIGH RISK even when coverage is thin. */
export function computeConfidence({ checks, checks_skipped }: Evidence): Confidence {
  const executed = checks.filter((c) => c.status === "ok");
  const notExecuted = checks.length - executed.length;
  const inconclusive = signalsAt(checks, "inconclusive").length;

  if (checks_skipped.length >= 2) return "low";
  if (executed.length === 0 || notExecuted + checks_skipped.length >= 2 || inconclusive >= 2) return "low";

  const noGaps = notExecuted === 0 && checks_skipped.length === 0 && inconclusive === 0;
  if (noGaps && executed.length >= 2 && findConflicts(checks).length === 0) return "high";
  return "medium";
}

export function computeVerdictReason({ checks, checks_skipped }: Evidence): string {
  const verdict = computeVerdict({ checks, checks_skipped });
  const executed = computeCoverage(checks, checks_skipped).executed;
  const parts: string[] = [];

  for (const level of verdict === "HIGH RISK" ? ["hard", "soft"] : ["soft"]) {
    parts.push(...signalsAt(checks, level).map((s) => s.explanation));
  }
  const conflicts = findConflicts(checks);
  if (conflicts.length > 0) parts.push(`Sources conflict on: ${conflicts.join(", ")}`);

  const inconclusive = checks
    .filter((c) => c.status === "ok" && c.signals.some((s) => s.level === "inconclusive"))
    .map((c) => c.name);
  if (inconclusive.length > 0) parts.push(`Inconclusive: ${inconclusive.join(", ")}`);

  const notExecuted = checks.filter((c) => c.status !== "ok").map((c) => c.name);
  if (notExecuted.length > 0) parts.push(`Failed or unconfirmed: ${notExecuted.join(", ")}`);
  if (checks_skipped.length > 0) parts.push(`Not checked: ${checks_skipped.map((c) => c.name).join(", ")}`);

  if (verdict === "CLEAR") {
    return `No material negative indicators across ${executed} executed checks. This is not a guarantee of safety.`;
  }
  if (executed === 0) parts.unshift("No evidence could be purchased, so no defensible verdict is possible");
  return `${parts.join(". ")}.`;
}
