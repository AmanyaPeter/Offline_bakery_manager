import { parseQuantity } from "../src/domain";
import { orderPending } from "../src/sync";
import "fake-indexeddb/auto";
import { describe, it, expect, afterEach } from "vitest";
import { BakeryDB } from "../src/db";
import { Synchronizer, type Transport } from "../src/sync";
import {
  report,
  validate,
  type Identity,
  type BusinessEvent,
} from "../src/domain";
import { restore } from "../src/recovery";
const ids = () => crypto.randomUUID();
const bakery = ids(),
  central = ids(),
  sellerLocation = ids();
const manager: Identity = {
  user_id: ids(),
  bakery_id: bakery,
  location_id: central,
  role: "manager",
  name: "Manager",
};
const seller: Identity = {
  user_id: ids(),
  bakery_id: bakery,
  location_id: sellerLocation,
  role: "seller",
  name: "Seller",
};
const databases: BakeryDB[] = [];
function phone() {
  const d = new BakeryDB("test-" + ids());
  databases.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(databases.splice(0).map((d) => d.delete()));
});
function server() {
  const events: BusinessEvent[] = [];
  const transport: Transport = {
    async push(batch) {
      return batch.map((e) => {
        const old = events.find((x) => x.event_id === e.event_id);
        if (!old) events.push({ ...e, server_seq: events.length + 1 });
        return {
          event_id: e.event_id,
          accepted: true,
          server_seq: old?.server_seq || events.length,
        };
      });
    },
    async pull(cursor) {
      const page = events.filter((e) => e.server_seq! > cursor).slice(0, 2);
      return {
        events: page,
        next_cursor: page.at(-1)?.server_seq || cursor,
        has_more: events.some(
          (e) => e.server_seq! > (page.at(-1)?.server_seq || cursor),
        ),
      };
    },
  };
  return { events, transport };
}
describe("offline integrity", () => {
  it("saves record and outbox offline and persists after restart", async () => {
    const d = phone();
    await d.save(manager, "production", { quantity: 100 });
    expect(await d.records.count()).toBe(1);
    expect(await d.outbox.count()).toBe(1);
    d.close();
    await d.open();
    expect((await d.visible(manager))[0].payload.quantity).toBe(100);
  });
  it("rolls back the readable record if the outbox write fails", async () => {
    const d = phone();
    await d.open();
    d.outbox.hook("creating", () => {
      throw new Error("Disk full");
    });
    await expect(
      d.save(manager, "production", { quantity: 100 }),
    ).rejects.toThrow("Disk full");
    expect(await d.records.count()).toBe(0);
  });
  it("does not save an invalid or fractional quantity", async () => {
    const d = phone();
    await expect(
      d.save(manager, "production", { quantity: 1.5 }),
    ).rejects.toThrow();
    expect(await d.records.count()).toBe(0);
  });
  it("retains pending records after an interrupted upload, with exactly-once retry", async () => {
    const d = phone(),
      s = server();
    await d.save(manager, "production", { quantity: 100 });
    const interrupted: Transport = {
      ...s.transport,
      push: async (e) => {
        await s.transport.push(e);
        throw new Error("Connection lost");
      },
    };
    await expect(
      new Synchronizer(d, interrupted).run(manager),
    ).rejects.toThrow();
    expect(await d.outbox.count()).toBe(1);
    await new Synchronizer(d, s.transport).run(manager);
    expect(await d.outbox.count()).toBe(0);
    expect(s.events).toHaveLength(1);
  });
  it("retains and displays permission rejections and excludes them from stock", async () => {
    const d = phone();
    await d.save(manager, "production", { quantity: 100 });
    const t: Transport = {
      push: async (events) =>
        events.map((e) => ({
          event_id: e.event_id,
          accepted: false,
          error: "Role changed",
        })),
      pull: async (c) => ({ events: [], next_cursor: c, has_more: false }),
    };
    await new Synchronizer(d, t).run(manager);
    expect((await d.outbox.toArray())[0].status).toBe("rejected");
    expect(await d.records.count()).toBe(1);
    expect(await d.visible(manager)).toHaveLength(0);
  });
  it("applies pulled events and cursor atomically", async () => {
    const d = phone(),
      s = server();
    const e = await d.save(manager, "production", { quantity: 1 });
    const other = { ...e, event_id: ids(), bakery_id: ids() };
    await expect(
      d.apply(manager, [{ ...e, event_id: ids() }, other], 9),
    ).rejects.toThrow();
    expect(await d.records.count()).toBe(1);
    expect(await d.get("cursor:" + manager.user_id)).toBeUndefined();
  });
  it("keeps unacknowledged events pending", async () => {
    const d = phone();
    await d.save(manager, "production", { quantity: 10 });
    await new Synchronizer(d, {
      push: async () => [],
      pull: async (c) => ({ events: [], next_cursor: c, has_more: false }),
    }).run(manager);
    expect(await d.outbox.count()).toBe(1);
  });
  it("restores own recovery data for server revalidation without trusting backup flags", async () => {
    const a = phone(),
      b = phone();
    const e = await a.save(manager, "production", { quantity: 20 });
    expect(
      await restore(
        b,
        manager,
        JSON.stringify({ version: 1, records: [{ ...e, server_seq: 10 }] }),
      ),
    ).toBe(1);
    expect((await b.outbox.toArray())[0].status).toBe("pending");
    expect((await b.records.toArray())[0].server_seq).toBeUndefined();
    expect(
      await restore(b, manager, JSON.stringify({ version: 1, records: [e] })),
    ).toBe(0);
  });
  it("synchronizes three independently offline phones with paginated pull", async () => {
    const a = phone(),
      b = phone(),
      c = phone(),
      s = server();
    await a.save(manager, "production", { quantity: 200 });
    const allocation = await a.save(manager, "transfer", {
      quantity: 100,
      destination: sellerLocation,
    });
    await b.save(seller, "receipt", {
      quantity: 100,
      transfer_id: allocation.entity_id,
    });
    await b.save(seller, "sale", {
      quantity: 30,
      unit_price: 2000,
      amount_received: 40000,
      method: "cash",
      kind: "retail",
      customer: "Grace",
    });
    await c.save(manager, "purchase", {
      items: [{ ingredient_id: ids(), quantity: 50000, cost: 80000 }],
    });
    await c.save(manager, "sale", {
      quantity: 20,
      unit_price: 2000,
      amount_received: 40000,
      method: "mobile_money",
      kind: "wholesale",
      customer: "",
    });
    for (const [d, i] of [
      [a, manager],
      [b, seller],
      [c, manager],
    ] as const)
      await new Synchronizer(d, s.transport).run(i);
    for (const d of [a, b, c])
      await new Synchronizer(d, s.transport).run(manager);
    expect(s.events).toHaveLength(6);
    expect(await a.records.count()).toBe(6);
    const t = report(await a.records.toArray());
    expect(t.stock[central]).toBe(80);
    expect(t.stock[sellerLocation]).toBe(70);
    expect(t.revenue).toBe(100000);
    expect(t.cash).toBe(80000);
    expect(t.debt).toBe(20000);
    expect(t.purchases).toBe(80000);
    expect(t.discrepancies).toHaveLength(0);
    expect(await a.get("cursor:" + manager.user_id)).toBe(6);
  });
});
describe("business calculations", () => {
  async function events(actions: [Identity, any, any][]) {
    const d = phone();
    const result: BusinessEvent[] = [];
    for (const [i, t, p] of actions) result.push(await d.save(i, t, p));
    return result;
  }
  it("handles concurrent sales and a late production event without overwriting facts", async () => {
    const e = await events([
      [
        seller,
        "sale",
        {
          quantity: 5,
          unit_price: 1000,
          amount_received: 5000,
          method: "cash",
          kind: "retail",
        },
      ],
      [
        seller,
        "sale",
        {
          quantity: 7,
          unit_price: 1000,
          amount_received: 7000,
          method: "cash",
          kind: "retail",
        },
      ],
      [seller, "production", { quantity: 10 }],
    ]);
    expect(report(e).stock[sellerLocation]).toBe(-2);
    expect(report(e).discrepancies.length).toBeGreaterThan(0);
  });
  it("retains conflicting stock counts as observations", async () => {
    const e = await events([
      [manager, "production", { quantity: 100 }],
      [manager, "bread_count", { quantity: 98 }],
      [manager, "bread_count", { quantity: 99 }],
    ]);
    expect(report(e).stock[central]).toBe(100);
    expect(report(e).discrepancies).toHaveLength(2);
  });
  it("does not treat allocation as revenue and flags a different receipt", async () => {
    const e = await events([
      [manager, "production", { quantity: 100 }],
      [manager, "transfer", { quantity: 50, destination: sellerLocation }],
    ]);
    const d = phone();
    const r = await d.save(seller, "receipt", {
      quantity: 48,
      transfer_id: e[1].entity_id,
    });
    const t = report([...e, r]);
    expect(t.revenue).toBe(0);
    expect(t.stock[central]).toBe(50);
    expect(t.stock[sellerLocation]).toBe(48);
    expect(t.discrepancies).toHaveLength(1);
  });
  it("returns bread only after manager receipt and preserves transit stock", async () => {
    const e = await events([
      [seller, "production", { quantity: 20 }],
      [seller, "return", { quantity: 5 }],
    ]);
    const d = phone();
    const r = await d.save(manager, "receipt", {
      quantity: 5,
      transfer_id: e[1].entity_id,
    });
    expect(report(e).stock[central]).toBeUndefined();
    expect(report([...e, r]).stock[central]).toBe(5);
    expect(report([...e, r]).stock[sellerLocation]).toBe(15);
  });
  it("costs classified ingredient use at weighted average and does not expense purchases twice", async () => {
    const ing = ids();
    const e = await events([
      [
        manager,
        "purchase",
        {
          items: [
            { ingredient_id: ing, quantity: 100, cost: 10000 },
            { ingredient_id: ing, quantity: 100, cost: 20000 },
          ],
        },
      ],
      [manager, "ingredient_count", { ingredient_id: ing, quantity: 150 }],
      [
        manager,
        "ingredient_adjustment",
        {
          ingredient_id: ing,
          quantity: -50,
          classification: "estimated_production_use",
        },
      ],
      [manager, "expense", { category: "Transport", amount: 1000 }],
    ]);
    const t = report(e);
    expect(t.purchases).toBe(30000);
    expect(t.estimatedUse).toBe(7500);
    expect(t.ingredients[ing]).toEqual({ quantity: 150, value: 22500 });
    expect(t.estimatedProductionMargin).toBe(-8500);
  });
  it("supports partial and later payments", async () => {
    const e = await events([
      [
        seller,
        "sale",
        {
          quantity: 10,
          unit_price: 2000,
          amount_received: 5000,
          method: "cash",
          kind: "wholesale",
          customer: "Jane",
        },
      ],
    ]);
    const d = phone();
    const payment = await d.save(seller, "payment", {
      sale_id: e[0].entity_id,
      amount: 7000,
      method: "mobile_money",
    });
    expect(report([...e, payment]).debt).toBe(8000);
    expect(report([...e, payment]).cash).toBe(12000);
  });
  it("reverses a fact without deleting its audit record", async () => {
    const e = await events([[manager, "production", { quantity: 100 }]]);
    const d = phone();
    const r = await d.save(manager, "reversal", {
      event_id: e[0].event_id,
      notes: "Wrong quantity",
    });
    expect(report([...e, r]).produced).toBe(0);
    expect([...e, r]).toHaveLength(2);
  });
  it("calculates cumulative profit estimates without double-counting inventory purchases", async () => {
    const ing = ids();
    const e = await events([
      [
        manager,
        "purchase",
        { items: [{ ingredient_id: ing, quantity: 100, cost: 10000 }] },
      ],
      [
        manager,
        "ingredient_adjustment",
        {
          ingredient_id: ing,
          quantity: -100,
          classification: "estimated_production_use",
        },
      ],
      [manager, "production", { quantity: 100 }],
      [
        manager,
        "sale",
        {
          quantity: 50,
          unit_price: 1000,
          amount_received: 50000,
          method: "cash",
          kind: "retail",
        },
      ],
      [manager, "expense", { category: "Transport", amount: 2000 }],
    ]);
    const t = report(e);
    expect(t.estimatedCostSold).toBe(5000);
    expect(t.estimatedGross).toBe(45000);
    expect(t.estimatedNet).toBe(43000);
  });
  it("rejects invalid credit and floating point money", () => {
    expect(() =>
      validate("sale", {
        quantity: 10,
        unit_price: 1000.1,
        amount_received: 0,
        method: "credit",
        kind: "retail",
        customer: "A",
      }),
    ).toThrow();
    expect(() =>
      validate("sale", {
        quantity: 10,
        unit_price: 1000,
        amount_received: 1,
        method: "credit",
        kind: "retail",
        customer: "A",
      }),
    ).toThrow();
  });
});

it("orders queued payments and reversals after the facts they reference", async () => {
  const d = phone();
  const sale = await d.save(seller, "sale", {
    quantity: 10,
    unit_price: 2000,
    amount_received: 0,
    method: "credit",
    kind: "wholesale",
    customer: "Jane",
  });
  const payment = await d.save(seller, "payment", {
    sale_id: sale.entity_id,
    amount: 5000,
    method: "cash",
  });
  const reversal = await d.save(manager, "reversal", {
    event_id: payment.event_id,
    notes: "Wrong payment",
  });
  const items = await d.outbox.toArray();
  const ordered = orderPending([
    items.find((x) => x.event_id === reversal.event_id)!,
    items.find((x) => x.event_id === payment.event_id)!,
    items.find((x) => x.event_id === sale.event_id)!,
  ]);
  expect(ordered.map((x) => x.event_id)).toEqual([
    sale.event_id,
    payment.event_id,
    reversal.event_id,
  ]);
});
it("initializes a single account device identity under concurrent local saves", async () => {
  const d = phone();
  const [a, b] = await Promise.all([
    d.save(manager, "production", { quantity: 1 }),
    d.save(manager, "production", { quantity: 2 }),
  ]);
  expect(a.device_id).toBe(b.device_id);
  expect(await d.records.count()).toBe(2);
});

it("converts familiar ingredient quantities to exact scaled integers", () => {
  expect(parseQuantity("1.5", 1000)).toBe(1500);
  expect(parseQuantity("-0.25", 1000)).toBe(-250);
  expect(parseQuantity("0.333", 1000)).toBe(333);
  expect(() => parseQuantity("1.5", 1)).toThrow("finely");
  expect(() => parseQuantity("1.0001", 1000)).toThrow("finely");
});
