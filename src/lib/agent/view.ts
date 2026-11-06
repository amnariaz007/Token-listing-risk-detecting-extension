import { renderAppendix, decodeBody } from "../memo/appendix.ts";
import { renderMemo } from "../memo/render.ts";
import { verifyBundle } from "../memo/verify.ts";
import type { AssessmentRecord } from "../storage/assessments.ts";

/** What pages show about a stored assessment. All report text comes from the same renderers as the PDF. */
export async function buildView(record: AssessmentRecord) {
  const { bundle } = record;
  return {
    id: record.id,
    summary: record.summary,
    signed: bundle.signed,
    evidence: bundle.raw_evidence.map((raw) => {
      const text = decodeBody(raw);
      let response: unknown = text;
      try {
        response = text === null ? null : JSON.parse(text);
      } catch {
        /* Non-JSON responses are shown as text. */
      }
      const { body_base64: _body, ...rest } = raw;
      return { ...rest, response };
    }),
    memo_text: renderMemo(bundle.signed.memo),
    appendix_text: renderAppendix(bundle),
    verification: await verifyBundle(bundle),
  };
}
export type AssessmentView = Awaited<ReturnType<typeof buildView>>;
