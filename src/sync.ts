import type { BakeryDB } from "./db";
import type { BusinessEvent, Identity } from "./domain";
export interface Transport {
  push(
    events: BusinessEvent[],
  ): Promise<
    {
      event_id: string;
      accepted: boolean;
      error?: string;
      server_seq?: number;
    }[]
  >;
  pull(
    cursor: number,
  ): Promise<{
    events: BusinessEvent[];
    next_cursor: number;
    has_more: boolean;
  }>;
}
export class Synchronizer {
  private running = false;
  private failures = 0;
  private nextAttempt = 0;
  constructor(
    private db: BakeryDB,
    private transport: Transport,
  ) {}
  async run(identity: Identity, force = false) {
    if (this.running || (!force && Date.now() < this.nextAttempt)) return;
    this.running = true;
    try {
      const pending = (
        await this.db.outbox.where("status").equals("pending").toArray()
      ).filter(
        (x) =>
          x.event.user_id === identity.user_id &&
          x.event.bakery_id === identity.bakery_id,
      );
      for (let i = 0; i < pending.length; i += 25) {
        const batch = pending.slice(i, i + 25);
        const acks = await this.transport.push(batch.map((x) => x.event));
        await this.db.transaction(
          "rw",
          this.db.outbox,
          this.db.records,
          async () => {
            for (const ack of acks) {
              if (!batch.some((x) => x.event_id === ack.event_id))
                throw new Error("Unknown backup acknowledgment");
              if (ack.accepted) {
                await this.db.records.update(ack.event_id, {
                  server_seq: ack.server_seq,
                });
                await this.db.outbox.delete(ack.event_id);
              } else
                await this.db.outbox.update(ack.event_id, {
                  status: "rejected",
                  error: ack.error || "Server rejected this record.",
                });
            }
          },
        );
      }
      let cursor =
        (await this.db.get<number>("cursor:" + identity.user_id)) || 0;
      let more = true;
      let pages = 0;
      while (more && pages++ < 100) {
        const page = await this.transport.pull(cursor);
        if (
          page.next_cursor < cursor ||
          (page.has_more && page.next_cursor === cursor)
        )
          throw new Error("Backup cursor did not advance.");
        await this.db.apply(identity, page.events, page.next_cursor);
        cursor = page.next_cursor;
        more = page.has_more;
      }
      this.failures = 0;
      this.nextAttempt = 0;
      await this.db.set(
        "lastSync:" + identity.user_id,
        new Date().toISOString(),
      );
    } catch (e) {
      this.failures++;
      this.nextAttempt =
        Date.now() + Math.min(300000, 1000 * 2 ** Math.min(this.failures, 9));
      throw e;
    } finally {
      this.running = false;
    }
  }
}
