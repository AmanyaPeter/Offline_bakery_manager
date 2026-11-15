import Dexie, { type Table } from "dexie";
import {
  validate,
  type BusinessEvent,
  type Identity,
  type EventType,
} from "./domain";
export interface Outgoing {
  event_id: string;
  event: BusinessEvent;
  status: "pending" | "rejected";
  error?: string;
  attempts: number;
}
export class BakeryDB extends Dexie {
  records!: Table<BusinessEvent, string>;
  outbox!: Table<Outgoing, string>;
  meta!: Table<{ key: string; value: any }, string>;
  constructor(name = "bakery-manager") {
    super(name);
    this.version(1).stores({
      records: "event_id,[bakery_id+user_id],bakery_id,server_seq",
      outbox: "event_id,status",
      meta: "key",
    });
  }
  async get<T>(key: string): Promise<T | undefined> {
    return (await this.meta.get(key))?.value;
  }
  async set(key: string, value: unknown) {
    await this.meta.put({ key, value });
  }
  async save(
    identity: Identity,
    type: EventType,
    payload: unknown,
    effective_at = new Date().toISOString(),
  ) {
    const p = validate(type, payload);
    const now = new Date().toISOString();
    let device = await this.get<string>("device:" + identity.user_id);
    if (!device) {
      device = crypto.randomUUID();
      await this.set("device:" + identity.user_id, device);
    }
    const event: BusinessEvent = {
      event_id: crypto.randomUUID(),
      entity_id: crypto.randomUUID(),
      device_id: device,
      event_type: type,
      schema_version: 1,
      payload: p,
      client_created_at: now,
      effective_at,
      user_id: identity.user_id,
      bakery_id: identity.bakery_id,
      location_id:
        type === "bread_adjustment" && "location_id" in p && p.location_id
          ? String(p.location_id)
          : identity.location_id,
    };
    await this.transaction("rw", this.records, this.outbox, async () => {
      await this.records.add(event);
      await this.outbox.add({
        event_id: event.event_id,
        event,
        status: "pending",
        attempts: 0,
      });
    });
    return event;
  }
  async visible(identity: Identity) {
    const records = await this.records
      .where("bakery_id")
      .equals(identity.bakery_id)
      .toArray();
    const rejected = new Set(
      (await this.outbox.where("status").equals("rejected").toArray()).map(
        (e) => e.event_id,
      ),
    );
    const allowed = new Set(
      records
        .filter(
          (e) =>
            e.user_id === identity.user_id ||
            e.payload.destination === identity.location_id,
        )
        .map((e) => e.event_id),
    );
    return records
      .filter(
        (e) =>
          !rejected.has(e.event_id) &&
          (identity.role !== "seller" ||
            allowed.has(e.event_id) ||
            (e.event_type === "reversal" && allowed.has(e.payload.event_id))),
      )
      .sort(
        (a, b) =>
          a.effective_at.localeCompare(b.effective_at) ||
          a.client_created_at.localeCompare(b.client_created_at),
      );
  }
  async apply(identity: Identity, events: BusinessEvent[], cursor: number) {
    await this.transaction("rw", this.records, this.meta, async () => {
      for (const e of events) {
        if (e.bakery_id !== identity.bakery_id)
          throw new Error("Wrong bakery in backup response.");
        await this.records.put(e);
      }
      await this.set("cursor:" + identity.user_id, cursor);
    });
  }
}
export const db = new BakeryDB();
