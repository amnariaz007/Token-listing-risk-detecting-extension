// A thin client. All assessment logic stays in the app. This only forwards requests and polls.
const DEFAULT_BASE_URL = "http://127.0.0.1:4402";
importScripts("lib.js");

async function settings() {
  const { baseUrl, apiKey } = await chrome.storage.sync.get(["baseUrl", "apiKey"]);
  return { baseUrl: (baseUrl || DEFAULT_BASE_URL).replace(/\/$/, ""), apiKey: apiKey || "" };
}

async function resolvePage(page) {
  if (page.kind === "token") return page;
  const res = await fetch(`https://api.dexscreener.com/latest/dex/pairs/${page.chain}/${page.pair}`);
  if (!res.ok) throw new Error(`DEXScreener returned HTTP ${res.status}`);
  const token = globalThis.ListingRisk.tokenFromPair(await res.json(), page.chain);
  if (!token) throw new Error("Could not find the token for this pair.");
  return token;
}

async function api(path, init) {
  const { baseUrl } = await settings();
  let res;
  try {
    res = await fetch(`${baseUrl}${path}`, init);
  } catch {
    throw new Error(`Cannot reach the app at ${baseUrl}. Start it, or change the address in the extension options.`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `The app returned HTTP ${res.status}`);
  return body;
}

async function start(page) {
  const token = await resolvePage(page);
  const { apiKey } = await settings();
  const headers = { "content-type": "application/json" };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  const { run_id: runId } = await api("/api/assessments", { method: "POST", headers, body: JSON.stringify({ token: token.address, chain: token.chain }) });
  return { runId, token };
}

async function memo(id) {
  const { baseUrl } = await settings();
  const view = await api(`/api/assessments/${id}/view`);
  return globalThis.ListingRisk.panelModel(view, baseUrl);
}

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
  const handlers = {
    start: () => start(message.page),
    status: () => api(`/api/runs/${message.runId}/status`),
    memo: () => memo(message.memoId),
  };
  handlers[message.type]().then(
    (data) => reply({ ok: true, data }),
    (err) => reply({ ok: false, error: err.message }),
  );
  return true; // Keeps the channel open for the asynchronous reply.
});
