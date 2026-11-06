import PDFDocument from "pdfkit";
import { renderAppendix } from "./appendix.ts";
import { renderMemo } from "./render.ts";
import type { EvidenceBundle } from "./schema.ts";

const PAGE_HEIGHT = 792;
const MARGIN = 54;
const MAX_FONT_SIZE = 10;
const MIN_FONT_SIZE = 7;
const LINE_RATIO = 1.25;

/** The base PDF fonts cover Latin-1. The bundle keeps the exact original text. */
const printable = (line: string) => line.replace(/[^\x20-\x7e\xa0-\xff]/g, "?");

/** Prints the same text the app shows: page 1 is the memo, later pages are the appendix. */
export function renderPdf(bundle: EvidenceBundle): Promise<Buffer> {
  const { signed } = bundle;
  const memoLines = renderMemo(signed.memo).split("\n");
  const appendixLines = renderAppendix(bundle).split("\n");

  const usable = PAGE_HEIGHT - 2 * MARGIN;
  const fitted = usable / (memoLines.length * LINE_RATIO);
  const memoFont = Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, fitted));
  const appendixFont = 8;

  const generated = new Date(signed.memo.generated_at);
  const doc = new PDFDocument({
    size: "LETTER",
    margin: MARGIN,
    info: {
      Title: `Token Listing-Risk Memo ${signed.memo.memo_id}`,
      Subject: `Memo hash ${signed.memo_hash}`,
      CreationDate: generated,
      ModDate: generated,
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const print = (lines: string[], size: number) => {
    doc.font("Courier").fontSize(size);
    const step = size * LINE_RATIO;
    let y = MARGIN;
    for (const line of lines) {
      if (y + step > PAGE_HEIGHT - MARGIN) {
        doc.addPage();
        y = MARGIN;
      }
      doc.text(printable(line), MARGIN, y, { lineBreak: false });
      y += step;
    }
  };

  print(memoLines, memoFont);
  doc.addPage();
  print(appendixLines, appendixFont);
  doc.end();
  return done;
}
