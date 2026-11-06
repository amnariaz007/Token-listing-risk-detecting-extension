import { NextResponse, type NextRequest } from "next/server";

/**
 * Starting a run spends from the wallet. Accepted: same-origin JSON from the web app, or the browser extension.
 * A website cannot forge a chrome-extension:// origin. Set ASSESS_API_KEY to also require a key from the extension.
 */
export function guardSpending(req: NextRequest): NextResponse | null {
  const origin = req.headers.get("origin");
  if (req.headers.get("content-type") !== "application/json") return NextResponse.json({ error: "Send application/json." }, { status: 415 });
  if (!origin) return null;
  const url = new URL(origin);
  if (url.protocol === "chrome-extension:") {
    const key = process.env.ASSESS_API_KEY;
    if (key && req.headers.get("authorization") !== `Bearer ${key}`) return NextResponse.json({ error: "A valid API key is required. Set it in the extension options." }, { status: 401 });
    return null;
  }
  if (url.host !== req.headers.get("host")) return NextResponse.json({ error: "Cross-site requests are not allowed." }, { status: 403 });
  return null;
}
