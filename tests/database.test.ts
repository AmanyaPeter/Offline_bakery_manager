import "fake-indexeddb/auto";
import { BakeryDB } from "../src/db";
import { Synchronizer, type Transport } from "../src/sync";
import { report, type Identity } from "../src/domain";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { beforeAll, afterAll, it, expect } from "vitest";
const sql = new PGlite();
const owner = crypto.randomUUID(),
  other = crypto.randomUUID(),
  seller = crypto.randomUUID();
let bakery: string, central: string, sellerLoc: string;
async function as(user: string, role = "authenticated") {
  await sql.exec(
    `reset role; select set_config('test.uid','${user}',false);set role ${role};`,
  );
}
async function rpc(name: string, args: unknown[] = []) {
  const r = await sql.query<{ r: any }>(
    `select public.${name}(${args.map((_, i) => "$" + (i + 1)).join(",")}) as r`,
    args,
  );
  return r.rows[0].r;
}
function event(type: string, payload: unknown) {
  return {
    event_id: crypto.randomUUID(),
    entity_id: crypto.randomUUID(),
    device_id: crypto.randomUUID(),
    event_type: type,
    payload,
    schema_version: 1,
    client_created_at: new Date().toISOString(),
    effective_at: new Date().toISOString(),
  };
}
async function push(e: unknown[]) {
  return rpc("push_events", [JSON.stringify(e)]);
}
beforeAll(async () => {
  await sql.exec(
    `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;create function auth.jwt() returns jsonb language sql stable security definer as $$select jsonb_build_object('email',email) from auth.users where id=auth.uid()$$;grant usage on schema auth to authenticated,anon;grant execute on all functions in schema auth to authenticated,anon;`,
  );
  for (const file of readdirSync("supabase/migrations").sort()) {
    const source = readFileSync("supabase/migrations/" + file, "utf8").replace(
      "create extension if not exists pgcrypto;",
      "",
    );
    await sql.exec(source);
  }
  await sql.query("insert into auth.users values ($1,$2),($3,$4),($5,$6)", [
    owner,
    "owner@test.invalid",
    other,
    "other@test.invalid",
    seller,
    "seller@test.invalid",
  ]);
  await as(owner);
  await rpc("create_bakery", ["Test bakery", "Owner"]);
  await sql.exec("reset role");
  const p = (
    await sql.query<any>("select * from profiles where user_id=$1", [owner])
  ).rows[0];
  bakery = p.bakery_id;
  central = p.location_id;
  await as(other);
  await rpc("create_bakery", ["Other bakery", "Other"]);
  await as(owner);
  const code = await rpc("invite_user", ["seller@test.invalid", "seller"]);
  await as(seller);
  await rpc("accept_invitation", [code, "Seller"]);
  await sql.exec("reset role");
  sellerLoc = (
    await sql.query<any>("select location_id from profiles where user_id=$1", [
      seller,
    ])
  ).rows[0].location_id;
}, 60000);
afterAll(async () => {
  await sql.close();
});
it("creates every table with RLS and no anonymous write grants", async () => {
  await sql.exec("reset role");
  const r = await sql.query<any>(
    `select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'`,
  );
  expect(r.rows.length).toBeGreaterThanOrEqual(23);
  expect(r.rows.every((r) => r.relrowsecurity)).toBe(true);
});
it("derives ownership, accepts duplicate event only once and rejects changed replay", async () => {
  await as(owner);
  const e = {
    ...event("production", { quantity: 100 }),
    bakery_id: crypto.randomUUID(),
    user_id: other,
    location_id: sellerLoc,
  };
  expect((await push([e]))[0].accepted).toBe(false);
  e.location_id = central;
  const ack = await push([e]);
  expect(ack[0].accepted).toBe(true);
  expect((await push([e]))[0].server_seq).toBe(ack[0].server_seq);
  expect((await push([{ ...e, payload: { quantity: 101 } }]))[0].accepted).toBe(
    false,
  );
  await sql.exec("reset role");
  const r = await sql.query<any>(
    "select * from sync_events where event_id=$1",
    [e.event_id],
  );
  expect(r.rows).toHaveLength(1);
  expect(r.rows[0].bakery_id).toBe(bakery);
  expect(r.rows[0].location_id).toBe(central);
  expect(r.rows[0].user_id).toBe(owner);
});
it("rejects seller production and direct writes", async () => {
  await as(seller);
  expect(
    (await push([event("production", { quantity: 100 })]))[0].accepted,
  ).toBe(false);
  await expect(
    sql.query("update profiles set role=$1 where user_id=$2", [
      "owner",
      seller,
    ]),
  ).rejects.toThrow();
  await expect(
    rpc("owner_config", [
      "ingredient",
      { name: "Flour", unit: "kg", scale: 1000 },
    ]),
  ).rejects.toThrow();
});
it("isolates other bakeries and denies cross-bakery allocations", async () => {
  await as(other);
  const page = await rpc("pull_events", [0]);
  expect(page.events).toHaveLength(0);
  expect(
    (
      await push([event("transfer", { quantity: 10, destination: sellerLoc })])
    )[0].accepted,
  ).toBe(false);
  const rows = await sql.query("select * from profiles");
  expect(rows.rows).toHaveLength(1);
});
it("confirms transfers once, keeps discrepancies, and handles returns idempotently", async () => {
  await as(owner);
  const transfer = event("transfer", { quantity: 20, destination: sellerLoc });
  expect((await push([transfer]))[0].accepted).toBe(true);
  await as(seller);
  const receipt = event("receipt", {
    quantity: 18,
    transfer_id: transfer.entity_id,
  });
  expect((await push([receipt]))[0].accepted).toBe(true);
  expect(
    (
      await push([
        event("receipt", { quantity: 20, transfer_id: transfer.entity_id }),
      ])
    )[0].accepted,
  ).toBe(false);
  const returned = event("return", { quantity: 5 });
  expect((await push([returned]))[0].accepted).toBe(true);
  expect((await push([returned]))[0].accepted).toBe(true);
  await as(owner);
  expect(
    (
      await push([
        event("receipt", { quantity: 5, transfer_id: returned.entity_id }),
      ])
    )[0].accepted,
  ).toBe(true);
  await sql.exec("reset role");
  expect(
    (
      await sql.query<any>("select status from bread_transfers where id=$1", [
        transfer.entity_id,
      ])
    ).rows[0].status,
  ).toBe("disputed");
});
it("validates whole quantities and partial payments atomically", async () => {
  await as(seller);
  expect(
    (
      await push([
        event("sale", {
          quantity: 1.5,
          unit_price: 2000,
          amount_received: 0,
          method: "credit",
          kind: "retail",
          customer: "Jane",
        }),
      ])
    )[0].accepted,
  ).toBe(false);
  const sale = event("sale", {
    quantity: 10,
    unit_price: 2000,
    amount_received: 5000,
    method: "cash",
    kind: "retail",
    customer: "Jane",
  });
  expect((await push([sale]))[0].accepted).toBe(true);
  expect(
    (
      await push([
        event("payment", {
          sale_id: sale.entity_id,
          amount: 10000,
          method: "mobile_money",
        }),
      ])
    )[0].accepted,
  ).toBe(true);
  expect(
    (
      await push([
        event("payment", {
          sale_id: sale.entity_id,
          amount: 6000,
          method: "cash",
        }),
      ])
    )[0].accepted,
  ).toBe(false);
});
it("rejects stale permissions and revoked devices", async () => {
  await as(owner);
  const e = event("production", { quantity: 5 });
  expect((await push([e]))[0].accepted).toBe(true);
  await rpc("owner_config", ["revoke_device", { device_id: e.device_id }]);
  expect(
    (
      await push([
        { ...event("production", { quantity: 5 }), device_id: e.device_id },
      ])
    )[0].accepted,
  ).toBe(false);
  await rpc("owner_config", ["role", { user_id: seller, role: "manager" }]);
  await rpc("owner_config", ["role", { user_id: seller, role: "seller" }]);
  await as(seller);
  expect((await push([event("production", { quantity: 5 })]))[0].accepted).toBe(
    false,
  );
});
it("paginates more than 100 records without duplicates or gaps", async () => {
  await as(owner);
  for (let n = 0; n < 5; n++)
    expect(
      (
        await push(
          Array.from({ length: 25 }, () =>
            event("production", { quantity: 1 }),
          ),
        )
      ).every((a: any) => a.accepted),
    ).toBe(true);
  let cursor = 0;
  const seen = new Set<string>();
  let pages = 0;
  for (;;) {
    const page = await rpc("pull_events", [cursor]);
    for (const e of page.events) {
      expect(seen.has(e.event_id)).toBe(false);
      seen.add(e.event_id);
      expect(e.server_seq).toBeGreaterThan(cursor);
    }
    cursor = page.next_cursor;
    pages++;
    if (!page.has_more) break;
  }
  expect(pages).toBeGreaterThanOrEqual(2);
  expect(seen.size).toBeGreaterThanOrEqual(125);
}, 30000);

it("integrates three offline IndexedDB phones through real SQL synchronization", async () => {
  await as(owner);
  await rpc("owner_config", [
    "ingredient",
    { name: "Flour", unit: "kg", scale: 1000 },
  ]);
  await sql.exec("reset role");
  const ingredient = (
    await sql.query<any>("select id from ingredients where bakery_id=$1", [
      bakery,
    ])
  ).rows[0].id;
  const sellerProfile = (
    await sql.query<any>("select * from profiles where user_id=$1", [seller])
  ).rows[0];
  const boss: Identity = {
    user_id: owner,
    bakery_id: bakery,
    location_id: central,
    role: "owner",
    name: "Owner",
  };
  const vendor: Identity = { ...sellerProfile };
  const phones = [
    new BakeryDB("sql-a-" + crypto.randomUUID()),
    new BakeryDB("sql-b-" + crypto.randomUUID()),
    new BakeryDB("sql-c-" + crypto.randomUUID()),
  ];
  try {
    const [a, b, c] = phones;
    const production = await a.save(boss, "production", { quantity: 200 });
    const allocation = await a.save(boss, "transfer", {
      quantity: 100,
      destination: vendor.location_id,
    });
    const receipt = await b.save(vendor, "receipt", {
      quantity: 100,
      transfer_id: allocation.entity_id,
    });
    const sale = await b.save(vendor, "sale", {
      quantity: 30,
      unit_price: 2000,
      amount_received: 40000,
      method: "cash",
      kind: "retail",
      customer: "Three phone customer",
    });
    const laterPayment = await b.save(vendor, "payment", {
      sale_id: sale.entity_id,
      amount: 5000,
      method: "cash",
    });
    const purchase = await c.save(boss, "purchase", {
      items: [{ ingredient_id: ingredient, quantity: 50000, cost: 80000 }],
    });
    const bakerySale = await c.save(boss, "sale", {
      quantity: 20,
      unit_price: 2000,
      amount_received: 40000,
      method: "cash",
      kind: "wholesale",
    });
    const selected = new Set(
      [
        production,
        allocation,
        receipt,
        sale,
        laterPayment,
        purchase,
        bakerySale,
      ].map((e) => e.event_id),
    );
    const adapter = (i: Identity): Transport => ({
      push: async (es) => {
        await as(i.user_id);
        return push(es);
      },
      pull: async (cursor) => {
        await as(i.user_id);
        return rpc("pull_events", [cursor]);
      },
    });
    for (const [d, i] of [
      [a, boss],
      [b, vendor],
      [c, boss],
    ] as const)
      await new Synchronizer(d, adapter(i)).run(i);
    await new Synchronizer(a, adapter(boss)).run(boss);
    await new Synchronizer(a, adapter(boss)).run(boss);
    expect(await a.outbox.count()).toBe(0);
    expect(await b.outbox.count()).toBe(0);
    expect(await c.outbox.count()).toBe(0);
    const facts = (await a.records.toArray()).filter((e) =>
      selected.has(e.event_id),
    );
    expect(facts).toHaveLength(7);
    const totals = report(facts);
    expect(totals.stock[central]).toBe(80);
    expect(totals.stock[vendor.location_id]).toBe(70);
    expect(totals.revenue).toBe(100000);
    expect(totals.debt).toBe(15000);
    expect(totals.purchases).toBe(80000);
    expect(totals.discrepancies).toHaveLength(0);
    await sql.exec("reset role");
    const count = await sql.query<any>(
      "select count(*)::integer as n from sync_events where event_id=any($1::uuid[])",
      [Array.from(selected)],
    );
    expect(count.rows[0].n).toBe(7);
  } finally {
    await Promise.all(phones.map((d) => d.delete()));
  }
}, 30000);
it("binds invitations to email and prevents client role escalation", async () => {
  await as(owner);
  const token = await rpc("invite_user", ["new-person@test.invalid", "seller"]);
  await as(other);
  await expect(
    rpc("accept_invitation", [token, "Pretender"]),
  ).rejects.toThrow();
  await expect(
    sql.query(
      "insert into profiles(user_id,bakery_id,role,location_id,name) values($1,$2,$3,$4,$5)",
      [other, bakery, "owner", central, "Pretender"],
    ),
  ).rejects.toThrow();
});

it("requires reversal reasons, protects closed transfers, and rejects stale locations", async () => {
  await as(owner);
  const e = event("production", { quantity: 4 });
  expect((await push([e]))[0].accepted).toBe(true);
  expect(
    (await push([event("reversal", { event_id: e.event_id })]))[0].accepted,
  ).toBe(false);
  expect(
    await push([
      event("reversal", { event_id: e.event_id, notes: "Mistaken production" }),
    ]),
  ).toMatchObject([{ accepted: true }]);
  expect(
    (
      await push([
        event("reversal", {
          event_id: e.event_id,
          notes: "Duplicate reversal",
        }),
      ])
    )[0].accepted,
  ).toBe(false);
  await as(seller);
  expect(
    (
      await push([
        {
          ...event("sale", {
            quantity: 1,
            unit_price: 2000,
            amount_received: 2000,
            method: "cash",
            kind: "retail",
          }),
          location_id: central,
        },
      ])
    )[0].accepted,
  ).toBe(false);
});

it("allows only an owner to resolve a discrepancy without deleting the observation", async () => {
  await as(owner);
  const count = event("bread_count", { quantity: 123 });
  expect((await push([count]))[0].accepted).toBe(true);
  await as(seller);
  expect(
    (
      await push([
        event("resolution", {
          event_id: count.event_id,
          notes: "Not authorized",
        }),
      ])
    )[0].accepted,
  ).toBe(false);
  await as(owner);
  const resolution = event("resolution", {
    event_id: count.event_id,
    notes: "Count reviewed against late sales; no bread missing.",
  });
  expect((await push([resolution]))[0].accepted).toBe(true);
  expect(
    (
      await push([
        event("resolution", {
          event_id: count.event_id,
          notes: "Duplicate resolution",
        }),
      ])
    )[0].accepted,
  ).toBe(false);
  await sql.exec("reset role");
  expect(
    (
      await sql.query<any>(
        "select resolution_event_id from sync_conflicts where event_id=$1",
        [count.event_id],
      )
    ).rows[0].resolution_event_id,
  ).toBe(resolution.event_id);
  expect(
    (
      await sql.query<any>(
        "select count(*)::int as n from sync_events where event_id=$1",
        [count.event_id],
      )
    ).rows[0].n,
  ).toBe(1);
});
