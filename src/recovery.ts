import { z } from "zod";
import { validate, type Identity, type BusinessEvent } from "./domain";
import type { BakeryDB } from "./db";
const record = z.object({
  event_id: z.string().uuid(),
  entity_id: z.string().uuid(),
  device_id: z.string().uuid(),
  event_type: z.string(),
  schema_version: z.literal(1),
  payload: z.record(z.string(), z.unknown()),
  client_created_at: z.string().datetime(),
  effective_at: z.string().datetime(),
  user_id: z.string().uuid(),
  bakery_id: z.string().uuid(),
  location_id: z.string().uuid(),
  server_seq: z.number().int().positive().optional(),
});
export async function restore(db: BakeryDB, identity: Identity, text: string) {
  if (text.length > 20000000) throw new Error("Recovery file is too large.");
  const input = z
    .object({ version: z.literal(1), records: z.array(record) })
    .parse(JSON.parse(text));
  let count = 0;
  await db.transaction("rw", db.records, db.outbox, async () => {
    for (const raw of input.records) {
      const e = raw as BusinessEvent;
      if (e.user_id !== identity.user_id || e.bakery_id !== identity.bakery_id)
        continue;
      validate(e.event_type, e.payload);
      if (await db.records.get(e.event_id)) continue;
      await db.records.add({ ...e, server_seq: undefined });
      await db.outbox.add({
        event_id: e.event_id,
        event: { ...e, server_seq: undefined },
        status: "pending",
        attempts: 0,
      });
      count++;
    }
  });
  return count;
}
