// Adds a button and panel to token pages. Everything from the network is written with textContent, so page and miner text cannot inject markup.
(() => {
  const { parseTokenPage } = globalThis.ListingRisk;
  const VERDICT_COLORS = { CLEAR: "#1d7a46", CAUTION: "#9a6a00", "HIGH RISK": "#b3261e" };
  const STYLES = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    button { font-size: inherit; cursor: pointer; }
    .launch { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; padding: 10px 14px; border: 0; border-radius: 8px; background: #17324f; color: #fff; font-size: 14px; font-weight: 600; box-shadow: 0 2px 10px rgba(0,0,0,.3); }
    .panel { position: fixed; right: 20px; bottom: 70px; z-index: 2147483647; width: min(440px, calc(100vw - 40px)); max-height: 75vh; overflow: auto; padding: 16px; border-radius: 10px; background: #fff; color: #1c1b18; font-size: 13px; line-height: 1.45; box-shadow: 0 6px 30px rgba(0,0,0,.35); }
    .row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .tag { font-size: 11px; font-weight: 700; color: #9a6a00; }
    .close { border: 0; background: none; font-size: 18px; color: #555; }
    .verdict { font-size: 22px; font-weight: 700; margin: 8px 0 2px; }
    .muted { color: #5c5a54; }
    .small { font-size: 12px; }
    table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
    th { text-align: left; font-weight: 600; color: #5c5a54; border-bottom: 1px solid #ddd; padding: 3px 4px; }
    td { border-bottom: 1px solid #eee; padding: 4px; vertical-align: top; }
    .error { color: #b3261e; }
    .run { width: 100%; margin-top: 10px; padding: 9px; border: 0; border-radius: 6px; background: #17324f; color: #fff; font-weight: 600; }
    .run:disabled { opacity: .6; cursor: progress; }
    a { color: #1f4e8c; }
    code { font: 11px ui-monospace, Menlo, Consolas, monospace; word-break: break-all; }
  `;

  const el = (tag, props = {}, ...kids) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...kids);
    return node;
  };
  const send = (message) =>
    new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (res) => {
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!res?.ok) return reject(new Error(res?.error || "No response from the extension."));
        resolve(res.data);
      });
    });

  let host = null;

  function mount(page) {
    const shadowHost = el("div", { id: "listing-risk-root" });
    const root = shadowHost.attachShadow({ mode: "closed" });
    root.append(el("style", { textContent: STYLES }));
    const panel = el("div", { className: "panel", hidden: true });
    const launch = el("button", { className: "launch", textContent: "Listing Risk" });
    launch.onclick = () => {
      panel.hidden = !panel.hidden;
    };
    root.append(panel, launch);
    document.documentElement.append(shadowHost);
    renderIntro(panel, page);
    return shadowHost;
  }

  function header(panel) {
    const close = el("button", { className: "close", textContent: "×", title: "Close" });
    close.setAttribute("aria-label", "Close");
    close.onclick = () => {
      panel.hidden = true;
    };
    return el("div", { className: "row" }, el("span", { className: "tag", textContent: "TESTNET PAYMENTS" }), close);
  }

  function renderIntro(panel, page) {
    const target = page.kind === "token" ? page.address : `pair ${page.pair}`;
    const run = el("button", { className: "run", textContent: "Run listing-risk assessment" });
    panel.replaceChildren(
      header(panel),
      el("p", { textContent: `${target} on ${page.chain}` }),
      el("p", { className: "muted small", textContent: "Buys forensic checks through Telegraph, paying with test USDC on Sepolia, up to about 0.07 USDC. No mainnet funds are used." }),
      run,
    );
    run.onclick = () => runAssessment(panel, page, run);
  }

  async function runAssessment(panel, page, button) {
    button.disabled = true;
    button.textContent = "Starting...";
    const line = el("p", { className: "muted small", textContent: "Contacting the app." });
    panel.append(line);
    try {
      const { runId } = await send({ type: "start", page });
      for (;;) {
        const status = await send({ type: "status", runId });
        if (status.latest) line.textContent = status.latest;
        if (status.error) throw new Error(status.error);
        if (status.done) {
          renderMemo(panel, await send({ type: "memo", memoId: status.memo_id }));
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    } catch (err) {
      line.className = "error small";
      line.textContent = err.message;
      button.disabled = false;
      button.textContent = "Try again";
    }
  }

  function renderMemo(panel, m) {
    const rows = m.rows.map((r) =>
      el("tr", {}, el("td", { textContent: r.name }), el("td", { textContent: r.finding }), el("td", { textContent: r.tier }), el("td", { textContent: r.cost })),
    );
    panel.replaceChildren(
      header(panel),
      el("div", { className: "verdict", textContent: m.verdict, style: `color:${VERDICT_COLORS[m.verdict] ?? "#333"}` }),
      el("div", { className: "muted small", textContent: `Confidence: ${m.confidence}. Coverage: ${m.coverage}.` }),
      el("p", { textContent: m.reason }),
      el("table", {}, el("thead", {}, el("tr", {}, ...["Check", "Finding", "Tier", "Cost"].map((h) => el("th", { textContent: h })))), el("tbody", {}, ...rows)),
      ...m.skipped.map((s) => el("p", { className: "muted small", textContent: `Skipped: ${s}` })),
      el("p", {}, el("strong", { textContent: `Total paid: ${m.total}` })),
      el("p", { className: m.verified ? "small" : "error small", textContent: m.verified ? "Signature verified." : "Signature verification failed." }),
      el("p", { className: "small" }, "Memo hash: ", el("code", { textContent: m.memoHash })),
      el("p", { className: "small" }, "Signer: ", el("code", { textContent: m.signer })),
      el("p", { className: "small" }, el("a", { href: m.memoUrl, target: "_blank", rel: "noreferrer", textContent: "Open signed memo" }), " · ", el("a", { href: m.evidenceUrl, target: "_blank", rel: "noreferrer", textContent: "Inspect receipts" })),
    );
  }

  // DEXScreener changes pages without reloading, so the URL is watched.
  let current = null;
  function sync() {
    if (location.href === current) return;
    current = location.href;
    host?.remove();
    host = null;
    const page = parseTokenPage(location.href);
    if (page) host = mount(page);
  }
  sync();
  setInterval(sync, 1000);
})();
