import type { Signal } from "../memo/schema.ts";
import type { TokenTarget } from "./input.ts";

export type Interpretation = { finding: string; signals: Signal[] };
/** verifiedAnswer is the miner's original answer, taken from a signal whose hash was re-derived. */
export type Interpreter = (body: unknown, token: TokenTarget, verifiedAnswer?: string | null) => Interpretation;

type Fields = Record<string, unknown>;

const clip = (text: string, max = 56) => (text.length > max ? `${text.slice(0, max - 3)}...` : text);
const signal = (level: Signal["level"], code: string, topic: string, explanation: string, basis: Signal["basis"] = "miner_reported"): Signal => ({ level, code, topic, basis, explanation });

/** unusable_answer means another miner might do better. Other codes are real answers, so no second source is bought. */
const inconclusive = (topic: string, why: string, code = "unusable_answer"): Interpretation => ({ finding: clip(why), signals: [signal("inconclusive", code, topic, why)] });

/**
 * A 200 only proves delivery: public signals show routed miners returning raw HTML.
 * Only fields shaped to the intent's format and marked "ok" are read. Everything else is inconclusive.
 * Miner text is untrusted data. It is matched against fixed patterns and never executed or sent to a model.
 */
function shapedResult(body: unknown, topic: string): { fields: Fields; ok: (name: string) => boolean } | Interpretation {
  if (!body || typeof body !== "object" || Array.isArray(body)) return inconclusive(topic, "Response was not a JSON object");
  const envelope = body as Fields;
  if (envelope.result_shape !== "intent" || !envelope.result || typeof envelope.result !== "object") {
    return inconclusive(topic, `Answer did not match the intent format (${String(envelope.shape_error ?? envelope.result_shape ?? "no shape")})`);
  }
  const status = (envelope.field_status ?? {}) as Record<string, string>;
  return { fields: envelope.result as Fields, ok: (name) => status[name] === "ok" };
}
const isFailure = (v: ReturnType<typeof shapedResult>): v is Interpretation => "signals" in v;

/**
 * Some miners answer in their own format because the intent publishes none. These are read only
 * from exact, named fields, and only if the answer is about the token that was asked about.
 * Anything else stays inconclusive, so nothing is inferred from free text.
 */
function rawResult(body: unknown, topic: string): Fields | Interpretation {
  const result = body && typeof body === "object" && !Array.isArray(body) ? (body as Fields).result : null;
  if (!result || typeof result !== "object" || Array.isArray(result)) return inconclusive(topic, "Response had no readable result");
  return result as Fields;
}
const isRawFailure = (v: Fields | Interpretation): v is Interpretation => Array.isArray((v as Interpretation).signals) && "finding" in v;
const sameAddress = (a: unknown, b: string | null) => typeof a === "string" && b !== null && a.toLowerCase() === b.toLowerCase();

/**
 * Reads TxLens's automated source review. Its own wording is "no visible access check", and it calls itself
 * a pattern check, not an audit. On 2026-11-06 it rated USDC and PEPE high from functions that do have
 * guards, so a high finding is unconfirmed and needs a person. HIGH RISK comes from confirmed token flags instead.
 */
export const interpretAudit: Interpreter = (body, token) => {
  const r = rawResult(body, "contract");
  if (isRawFailure(r)) return r;
  if (!sameAddress(r.contract, token.address)) return inconclusive("contract", "Audit answer was not about this contract");
  const counts = r.counts as { high?: unknown; medium?: unknown } | undefined;
  if (r.status !== "ok" || typeof counts?.high !== "number" || typeof counts?.medium !== "number") return inconclusive("contract", "No readable audit counts returned");
  const listed = Array.isArray(r.findings) ? (r.findings as { severity?: unknown; title?: unknown; category?: unknown }[]) : [];
  const titled = (severity: string) => listed.filter((f) => f.severity === severity).map((f) => `${String(f.severity).toUpperCase()}: ${String(f.title)} (${String(f.category)})`);
  const verified = r.source_verified === true;
  if (counts.high > 0) {
    return {
      finding: `${counts.high} high, unconfirmed`,
      signals: [{ ...signal("soft", "audit_high_unconfirmed", "contract", "Automated audit flagged high-severity patterns. Unconfirmed: needs human review"), details: titled("high") }],
    };
  }
  if (counts.medium > 0) {
    return { finding: `${counts.medium} medium-severity finding(s)`, signals: [{ ...signal("soft", "audit_medium_finding", "contract", "Automated audit found medium-severity issues"), details: titled("medium") }] };
  }
  if (!verified) return inconclusive("contract", "No published source, so the review was limited", "miner_inconclusive");
  return { finding: "No high or medium findings", signals: [signal("clear", "audit_clean", "contract", "Automated audit found no high or medium issues")] };
};

const flagged = (r: Fields, key: string) => r[key] === "1";
const HARD_FLAGS: [string, string][] = [
  ["is_honeypot", "Honeypot: holders may be unable to sell"],
  ["hidden_owner", "Hidden owner"],
  ["can_take_back_ownership", "Ownership can be taken back"],
  ["selfdestruct", "Contract can self-destruct"],
];
const SOFT_FLAGS: [string, string][] = [
  ["cannot_buy", "Buying is restricted"],
  ["is_mintable", "Supply can be minted"],
  ["is_proxy", "Upgradeable proxy"],
  ["transfer_pausable", "Transfers can be paused"],
  ["is_blacklisted", "Addresses can be blacklisted"],
  ["slippage_modifiable", "Tax can be changed"],
  ["external_call", "Makes external calls"],
];
export const MAX_TAX = 0.1;
/** Top-10 holders that are ordinary wallets. Contracts and locked or burned balances are left out, as they are often pools, vesting or burns. */
export const MAX_TOP_WALLET_SHARE = 0.5;

/** Reads GoPlus token flags and holder list. Takes concentration from here, because TOKEN_HOLDER_COUNT only returns a count. */
export const interpretTokenControls: Interpreter = (body, token) => {
  const r = rawResult(body, "controls");
  if (isRawFailure(r)) return r;
  const inner = r.result as Record<string, Fields> | undefined;
  const entry = token.address && inner ? inner[token.address.toLowerCase()] : undefined;
  if (r.code !== 1 || !entry || typeof entry.is_open_source !== "string") return inconclusive("controls", "No security flags returned for this contract");

  const signals: Signal[] = [];
  const hard = HARD_FLAGS.filter(([k]) => flagged(entry, k)).map(([, label]) => label);
  if (hard.length > 0) signals.push({ ...signal("hard", "token_control_red_flag", "controls", `Dangerous token controls: ${hard.join(", ")}`), details: hard });
  const soft = SOFT_FLAGS.filter(([k]) => flagged(entry, k)).map(([, label]) => label);
  if (entry.is_open_source !== "1") soft.push("Source is not published");
  for (const key of ["buy_tax", "sell_tax"]) {
    const tax = Number(entry[key]);
    if (entry[key] !== "" && Number.isFinite(tax) && tax > MAX_TAX) soft.push(`${key === "buy_tax" ? "Buy" : "Sell"} tax is ${(tax * 100).toFixed(1)}%`);
  }
  if (soft.length > 0) signals.push({ ...signal("soft", "token_control_flags", "controls", `Token controls need review: ${soft.join(", ")}`), details: soft });
  if (hard.length + soft.length === 0) signals.push(signal("clear", "token_controls_clean", "controls", "No risky token controls flagged"));

  const holders = Array.isArray(entry.holders) ? (entry.holders as { percent?: unknown; is_contract?: unknown; is_locked?: unknown; address?: unknown }[]) : [];
  const walletShare = holders.filter((h) => h.is_contract === 0 && h.is_locked === 0).reduce((sum, h) => sum + (Number(h.percent) || 0), 0);
  let concentration = "holders not listed";
  if (holders.length > 0) {
    concentration = `top wallets ${(walletShare * 100).toFixed(1)}%`;
    signals.push(
      walletShare >= MAX_TOP_WALLET_SHARE
        ? signal("soft", "holder_concentration", "concentration", `Top wallets hold ${(walletShare * 100).toFixed(1)}% of supply`)
        : signal("clear", "holders_dispersed", "concentration", "No wallet concentration flagged"),
    );
  } else {
    signals.push(signal("inconclusive", "miner_inconclusive", "concentration", "Holder list was not returned"));
  }
  const flagsText = hard.length ? `${hard.length} red flag(s)` : soft.length ? `${soft.length} flag(s)` : "No risky controls";
  return { finding: `${flagsText}; ${concentration}`, signals };
};

export const MIN_WASH_TRANSFERS = 20;
export const CONFIRMED_WASH_ROUND_TRIP = 50;
const CONFIRMED_WASH_MIN_TRANSFERS = 100;

/** Reads VerifyWire's on-chain scan. HIGH risk with most volume in round trips across many transfers counts as confirmed. */
export const interpretWashScan: Interpreter = (body, token) => {
  const r = rawResult(body, "market_integrity");
  if (isRawFailure(r)) return r;
  if (!sameAddress(r.contract_address, token.address)) return inconclusive("market_integrity", "Scan was not about this contract");
  const { risk_label: label, transfers, round_trip_volume_share_percent: roundTrip, risk_score: score } = r;
  if (typeof label !== "string" || typeof transfers !== "number" || typeof roundTrip !== "number") return inconclusive("market_integrity", "No readable wash-trading scan returned");
  const finding = `${label} risk, ${roundTrip}% round-trip`;
  if (transfers < MIN_WASH_TRANSFERS) return inconclusive("market_integrity", `Too few transfers to judge (${transfers})`, "miner_inconclusive");
  if (label === "HIGH" && roundTrip >= CONFIRMED_WASH_ROUND_TRIP && transfers >= CONFIRMED_WASH_MIN_TRANSFERS) {
    return { finding, signals: [signal("hard", "wash_trading_confirmed", "market_integrity", `Wash trading: ${roundTrip}% of volume moved in round trips across ${transfers} transfers`)] };
  }
  if (label !== "LOW") return { finding, signals: [signal("soft", "wash_trading_signals", "market_integrity", `Wash-trading signals: ${label} risk${typeof score === "number" ? ` (score ${score})` : ""}`)] };
  return { finding, signals: [signal("clear", "wash_low", "market_integrity", "Wash-trading scan shows low risk")] };
};

export const MIN_LIQUIDITY_USD = 50_000;
export const MIN_HOLDERS = 100;

export const interpretHolderCount: Interpreter = (body, token) => {
  const shaped = shapedResult(body, "holders");
  if (isFailure(shaped)) return shaped;
  const count = shaped.fields.holders_count;
  if (!shaped.ok("holders_count") || typeof count !== "number") return inconclusive("holders", "No holder count returned");
  if (typeof shaped.fields.token === "string" && token.address && !sameAddress(shaped.fields.token, token.address)) return inconclusive("holders", "Holder count was not about this contract");
  const finding = `${count.toLocaleString("en-US")} holders`;
  if (count < MIN_HOLDERS) return { finding, signals: [signal("soft", "few_holders", "holders", `Only ${count} holders`)] };
  return { finding, signals: [signal("clear", "holder_base", "holders", "Holder count above minimum")] };
};

export const interpretLiquidity: Interpreter = (body) => {
  const shaped = shapedResult(body, "liquidity");
  if (isFailure(shaped)) return shaped;
  const usd = shaped.fields.liquidity_usd;
  if (!shaped.ok("liquidity_usd") || typeof usd !== "number") return inconclusive("liquidity", "No liquidity figure returned");
  const finding = `$${Math.round(usd).toLocaleString("en-US")} top pool`;
  if (usd < MIN_LIQUIDITY_USD) return { finding, signals: [signal("soft", "thin_liquidity", "liquidity", "Thin liquidity")] };
  return { finding, signals: [signal("clear", "adequate_liquidity", "liquidity", "Top pool liquidity above minimum")] };
};

export const interpretPrice: Interpreter = (body) => {
  const shaped = shapedResult(body, "price");
  if (isFailure(shaped)) return shaped;
  const price = shaped.fields.price_usd;
  if (!shaped.ok("price_usd") || typeof price !== "number") return inconclusive("price", "No usable price for this symbol");
  return { finding: `$${price}`, signals: [signal("clear", "price_available", "price", "Market price available")] };
};

const HEADLINE = /"([^"]+)"\s*\(([^,()]+),\s*([^)]+)\)/g;
const NEGATIVE = /\b(scam|fraud\w*|rug ?pull\w*|exploit\w*|hack\w*|drain\w*|theft|stolen|breach\w*|sanction\w*|lawsuit\w*|ponzi|indict\w*|delist\w*|depeg\w*)\b/i;
/** Phrases where a miner says it found nothing to read. These must never count as "no bad news". */
const NON_ANSWER = /no (news )?sources matched|no dated matching|try rephrasing|could not find|no results|unable to (find|answer)/i;
const NEGATED = /\b(no|not|without|never|none|nothing|unable to find|did not find|found no)\b[^.]{0,60}\b(scam|fraud|rug ?pull|exploit|hack|drain|sanction|lawsuit|ponzi|indict|delist|depeg)/i;

/** A keyword in an article can only raise a soft signal. It is never a confirmed finding. */
export const interpretNews: Interpreter = (body, token, verifiedAnswer) => {
  const shaped = shapedResult(body, "reputation");
  const shapedAnswer = !isFailure(shaped) && shaped.ok("answer") && typeof shaped.fields.answer === "string" ? shaped.fields.answer : null;
  // Telegraph's shaping step can reject an answer the miner really gave (seen on 2026-11-06).
  // The original is used only when its signal hash was re-derived, so it is still verifiable.
  const answer = shapedAnswer?.trim() ? shapedAnswer : verifiedAnswer;
  if (!answer?.trim()) return isFailure(shaped) ? shaped : inconclusive("reputation", "No news answer returned");
  if (NON_ANSWER.test(answer)) return inconclusive("reputation", "The miner found no news to read");

  // Dated headlines cited with their source are the strongest form of news answer.
  const headlines = [...answer.matchAll(HEADLINE)].map((m) => ({ title: m[1] as string, source: m[2] as string, date: m[3] as string }));
  if (headlines.length > 0) {
    const adverse = headlines.filter((h) => NEGATIVE.test(h.title));
    const window = answer.match(/last (\d+) days/)?.[1];
    if (adverse.length > 0) {
      return {
        finding: `${adverse.length} negative${window ? `, ${window}d` : ""}`,
        signals: [{ ...signal("soft", "adverse_media", "reputation", "Recent adverse media needs review", "inference"), details: adverse.map((h) => `"${h.title}" (${h.source}, ${h.date})`) }],
      };
    }
    return { finding: `0 negative of ${headlines.length} headlines`, signals: [signal("clear", "no_adverse_media", "reputation", "No adverse media found", "inference")] };
  }
  if (isFailure(shaped)) return shaped;
  if (NON_ANSWER.test(answer)) return inconclusive("reputation", "The miner found no news to read");

  const names = [token.symbol, token.name, token.address].filter((n): n is string => Boolean(n));
  const mentions = (s: string) => names.some((n) => s.toLowerCase().includes(n.toLowerCase()));
  const negative = answer.split(/(?<=[.!?])\s+/).filter((s) => NEGATIVE.test(s) && !NEGATED.test(s) && mentions(s));
  if (negative.length > 0) {
    return {
      finding: `${negative.length} adverse mention(s)`,
      signals: [signal("soft", "adverse_media", "reputation", "Recent adverse media needs review", "inference")],
    };
  }
  // "Nothing bad happened" is only evidence if the miner cites where it looked.
  const sources = shaped.ok("sources") && Array.isArray(shaped.fields.sources) ? shaped.fields.sources : [];
  if (sources.length === 0 || shaped.fields.result_count === 0) {
    return inconclusive("reputation", "Miner reported no adverse news, but cited no sources", "unsourced_answer");
  }
  return { finding: `No adverse news in ${sources.length} sources`, signals: [signal("clear", "no_adverse_media", "reputation", "No adverse media found", "inference")] };
};

export const interpretFraud: Interpreter = (body) => {
  const shaped = shapedResult(body, "reputation");
  if (isFailure(shaped)) return shaped;
  const verdict = shaped.fields.verdict;
  if (!shaped.ok("verdict") || typeof verdict !== "string") return inconclusive("reputation", "No fraud verdict returned");
  const finding = `Fraud verdict: ${verdict}`;
  if (["FRAUD", "LIKELY_FRAUD", "HIGH"].includes(verdict)) {
    return { finding, signals: [signal("hard", "fraud_indicator", "reputation", `Fraud screen returned ${verdict}`)] };
  }
  if (["SUSPICIOUS", "ELEVATED"].includes(verdict)) {
    return { finding, signals: [signal("soft", "fraud_elevated", "reputation", `Fraud screen returned ${verdict}`)] };
  }
  if (["LEGITIMATE", "LOW"].includes(verdict)) {
    return { finding, signals: [signal("clear", "no_fraud_indicators", "reputation", "Fraud screen found no indicators")] };
  }
  return inconclusive("reputation", `Fraud screen was not conclusive (${verdict})`, "miner_inconclusive");
};

const CONFIRMED_MATCH_SCORE = 0.95;

/** A name match is not proof of identity. Only a near-exact match on an address or a full name is treated as confirmed. */
export const interpretSanctions: Interpreter = (body, token) => {
  const shaped = shapedResult(body, "sanctions");
  if (isFailure(shaped)) return shaped;
  const matched = shaped.fields.matched;
  if (!shaped.ok("matched") || typeof matched !== "boolean") return inconclusive("sanctions", "No sanctions result returned");
  if (!matched) return { finding: "No list match", signals: [signal("clear", "no_sanctions_match", "sanctions", "No sanctions-list match")] };
  const score = shaped.fields.match_score;
  const strongSubject = Boolean(token.address || token.name);
  if (typeof score === "number" && score >= CONFIRMED_MATCH_SCORE && strongSubject) {
    return { finding: `List match (score ${score})`, signals: [signal("hard", "sanctions_match", "sanctions", "Sanctions-list match on the token's identity")] };
  }
  return { finding: "Possible list match", signals: [signal("soft", "possible_sanctions_match", "sanctions", "Possible sanctions name match needs review")] };
};
