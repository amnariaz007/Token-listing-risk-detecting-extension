import { z } from "zod";
import { nodeUrl } from "../../config/protocol.ts";

const IntentListSchema = z.object({
  count: z.number().optional(),
  intents: z.array(z.object({ intent_name: z.string(), miner_count: z.number(), description: z.string().nullish(), canonical: z.boolean().nullish() })),
});

const ParamSchema = z.object({
  name: z.string(),
  type: z.string().optional(),
  required: z.boolean().optional(),
  description: z.string().optional(),
});
const FieldSchema = z.object({ name: z.string(), type: z.string().optional(), allowed: z.array(z.string()).optional() });

const IntentSchemaResponse = z.object({
  intent_name: z.string(),
  class: z.string().nullish(),
  miner_count: z.number().nullish(),
  request: z.object({ params: z.array(ParamSchema) }).nullish(),
  response: z.object({ fields: z.array(FieldSchema) }).nullish(),
});

const IntentMinersSchema = z.object({
  count: z.number(),
  miners: z.array(z.object({ id: z.string(), slug: z.string().nullish(), name: z.string().nullish() })),
});

export type IntentCapability = {
  intent: string;
  class: string | null;
  miner_count: number;
  params: z.infer<typeof ParamSchema>[] | null;
  response_fields: z.infer<typeof FieldSchema>[] | null;
  miners: { id: string; slug: string | null }[];
};

export type CapabilitySnapshot = {
  discovered_at: string;
  node: string;
  intent_count: number;
  capabilities: IntentCapability[];
};

async function getJson(url: string, fetchImpl: typeof fetch, timeoutMs = 30_000): Promise<unknown> {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${url} returned HTTP ${res.status}`);
  return res.json();
}

/** Live capabilities for the intents named. Availability is always read here and never assumed. */
export async function discoverCapabilities(names: string[], fetchImpl: typeof fetch = fetch, now: () => Date = () => new Date()): Promise<CapabilitySnapshot> {
  const node = nodeUrl();
  const list = IntentListSchema.parse(await getJson(`${node}/engine/v1/intents`, fetchImpl));
  const capabilities = await Promise.all(
    names.map(async (intent): Promise<IntentCapability> => {
      const listed = list.intents.find((i) => i.intent_name === intent);
      if (!listed) return { intent, class: null, miner_count: 0, params: null, response_fields: null, miners: [] };
      // The schema endpoint answers 200 for any name, so the list above decides whether an intent exists.
      const [schema, miners] = await Promise.all([
        getJson(`${node}/engine/v1/intents/${intent}`, fetchImpl).then((v) => IntentSchemaResponse.parse(v)),
        getJson(`${node}/engine/v1/intents/${intent}/miners`, fetchImpl).then((v) => IntentMinersSchema.parse(v)),
      ]);
      return {
        intent,
        class: schema.class ?? null,
        miner_count: miners.count,
        params: schema.request?.params ?? null,
        response_fields: schema.response?.fields ?? null,
        miners: miners.miners.map((m) => ({ id: m.id, slug: m.slug ?? null })),
      };
    }),
  );
  return { discovered_at: now().toISOString(), node, intent_count: list.intents.length, capabilities };
}

const MinerStatusSchema = z.array(
  z.object({ id: z.string(), slug: z.string().nullish(), activation_status: z.string().nullish(), min_price_usdc: z.number().nullish() }),
);

/** Miner price floors from /api/miners, which the docs name as the source for pricing. */
export async function fetchMinerPrices(intent: string, limit = 100, fetchImpl: typeof fetch = fetch) {
  const url = `${nodeUrl()}/api/miners?intent=${encodeURIComponent(intent)}&status=active&limit=${limit}`;
  return MinerStatusSchema.parse(await getJson(url, fetchImpl, 120_000));
}

export type NetworkStatus = { online: boolean; checked_at: string; intents: number | null; intents_with_miners: number | null; epoch: number | null; error: string | null };

export async function fetchNetworkStatus(fetchImpl: typeof fetch = fetch): Promise<NetworkStatus> {
  const checked_at = new Date().toISOString();
  try {
    const [list, epoch] = await Promise.all([
      getJson(`${nodeUrl()}/engine/v1/intents`, fetchImpl, 15_000).then((v) => IntentListSchema.parse(v)),
      getJson(`${nodeUrl()}/api/epoch`, fetchImpl, 15_000) as Promise<{ current_epoch?: number }>,
    ]);
    return {
      online: true,
      checked_at,
      intents: list.intents.length,
      intents_with_miners: list.intents.filter((i) => i.miner_count > 0).length,
      epoch: epoch.current_epoch ?? null,
      error: null,
    };
  } catch (err) {
    return { online: false, checked_at, intents: null, intents_with_miners: null, epoch: null, error: (err as Error).message };
  }
}
