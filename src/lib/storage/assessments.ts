import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentEvent, AssessmentResult } from "../agent/orchestrator.ts";
import { EvidenceBundleSchema, type EvidenceBundle } from "../memo/schema.ts";

const ID = /^LRM-\d{4}-[0-9A-Z]{4,}$/;
const dataRoot = () => process.env.DATA_DIR ?? join(process.cwd(), "data", "assessments");

export type AssessmentRecord = {
  id: string;
  bundle: EvidenceBundle;
  summary: { started_at: string; finished_at: string; duration_ms: number };
};

/** Append-only: a run's files are written once and never replaced. */
export function createStore(root = dataRoot()) {
  mkdirSync(root, { recursive: true });
  const dir = (id: string) => join(root, id);
  const read = (id: string, file: string): unknown => JSON.parse(readFileSync(join(dir(id), file), "utf8"));

  const save = (result: AssessmentResult, events: AgentEvent[]) => {
    const { bundle } = result;
    const id = bundle.signed.memo.memo_id;
    mkdirSync(dir(id), { recursive: true });
    const write = (file: string, value: unknown) => writeFileSync(join(dir(id), file), JSON.stringify(value, null, 2), { flag: "wx" });
    write("input.json", result.input);
    write("capabilities.json", result.capabilities);
    write("plan.json", result.plan);
    write("requests.json", bundle.raw_evidence.map(({ check, method, url, request_body, requested_at, responded_at, duration_ms, exchanges }) => ({ check, method, url, request_body, requested_at, responded_at, duration_ms, exchanges })));
    write("payments.json", bundle.raw_evidence.map(({ check, challenge, settlement, receipt }) => ({ check, challenge, settlement, receipt, confirmed: bundle.signed.memo.checks.find((c) => c.name === check)?.payment ?? null })));
    write("results.json", bundle.raw_evidence.map(({ check, body_base64, signal }) => ({ check, body_base64, signal })));
    write("memo.json", bundle.signed.memo);
    write("signature.json", { scheme: bundle.signed.scheme, memo_hash: bundle.signed.memo_hash, signer_address: bundle.signed.signer_address, signature: bundle.signed.signature, signed_at: bundle.signed.memo.signed_at });
    write("bundle.json", bundle);
    write("events.json", events);
    write("summary.json", { started_at: result.started_at, finished_at: result.finished_at, duration_ms: result.duration_ms });
    return id;
  };

  const load = (id: string): AssessmentRecord | null => {
    if (!ID.test(id) || !existsSync(join(dir(id), "bundle.json"))) return null;
    return { id, bundle: EvidenceBundleSchema.parse(read(id, "bundle.json")), summary: read(id, "summary.json") as AssessmentRecord["summary"] };
  };

  const batchFile = (id: string) => join(root, "_batches", `${id}.json`);

  return {
    /** A batch is a running index of its memos, so unlike a memo it is updated as it progresses. */
    saveBatch: (batch: { id: string }) => {
      mkdirSync(join(root, "_batches"), { recursive: true });
      writeFileSync(batchFile(batch.id), JSON.stringify(batch, null, 2));
    },
    loadBatch: (id: string): unknown => (/^B-[0-9A-F]{8}$/.test(id) && existsSync(batchFile(id)) ? JSON.parse(readFileSync(batchFile(id), "utf8")) : null),
    exists: (id: string) => existsSync(dir(id)),
    save,
    load,
    events: (id: string): AgentEvent[] | null => (ID.test(id) && existsSync(join(dir(id), "events.json")) ? (read(id, "events.json") as AgentEvent[]) : null),
    plan: (id: string): unknown => (ID.test(id) && existsSync(join(dir(id), "plan.json")) ? read(id, "plan.json") : null),
    capabilities: (id: string): unknown => (ID.test(id) && existsSync(join(dir(id), "capabilities.json")) ? read(id, "capabilities.json") : null),
    list: (): AssessmentRecord[] =>
      readdirSync(root)
        .filter((id) => ID.test(id))
        .map(load)
        .filter((r): r is AssessmentRecord => r !== null)
        .sort((a, b) => (a.summary.started_at < b.summary.started_at ? 1 : -1)),
  };
}
export type Store = ReturnType<typeof createStore>;
