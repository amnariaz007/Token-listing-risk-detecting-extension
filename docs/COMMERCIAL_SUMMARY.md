# Commercial summary

**Status:** a hackathon build on Ethereum Sepolia testnet. It has no customers, partners or revenue.

## Who it serves

Listing and due-diligence teams at exchanges, OTC desks, crypto compliance teams and digital-asset researchers.

## The problem

Listing reviews take analysts a long time, and the findings are hard to audit later. Teams often can't show what a decision was based on, or what it cost.

## What it does today

From a button on a block explorer's token page, or a watchlist of up to ten tokens, an agent finds which intelligence is available on Telegraph, buys it within a fixed budget, and verifies each payment. It then issues a signed one-page memo with a verdict, its evidence, its gaps and its cost.

## How it uses Telegraph

It makes machine-to-machine x402 purchases through `POST /engine/v1/ask`. Each purchase goes to a miner suited to the question, or is routed by the network. Each purchase keeps Telegraph's receipt, the on-chain settlement and a signal hash that anyone can re-derive.

## What it buys

For a contract: an automated source audit, token controls and holder concentration, sanctions screening, a wash-trading scan, holder count, and the liquidity of its largest pool. For a bare symbol: price, adverse media and a fraud screen. All depend on what is live.

## What the agent automates

Capability discovery, check selection, budget control, payment, evidence collection, a first-pass verdict and memo signing. A person still makes the listing decision.

## How it reduces manual work

It handles the first-pass evidence gathering and paperwork, so an analyst starts from a sourced memo that names its gaps. It does not replace an analyst, and its time savings have not been measured.

## Why someone would adopt it

- Every claim links to a receipt and a raw response.
- It reports what it could not check, instead of implying a clean result.
- Cost is per request, with no seat licence.

## How it could become a product

- Publish the extension to the browser stores, and let teams connect their own wallet.
- Add team accounts, review workflows and an API for listing pipelines.
- Charge per memo or by subscription. Pricing is untested.

## How to try it

Follow `docs/SETUP.md`. It needs a burner wallet and free test tokens, and no mainnet funds.
