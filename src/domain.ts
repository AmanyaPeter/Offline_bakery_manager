import { z } from "zod";
const id = z.string().uuid(),
  qty = z.number().int().positive().max(1000000),
  money = z.number().int().nonnegative().max(1000000000),
  note = z.string().max(500).default("");
const base = { notes: note };
export const payloads = {
  production: z.object({
    ...base,
    quantity: qty,
    inputs: z
      .array(z.object({ ingredient_id: id, quantity: qty }))
      .min(1)
      .max(30)
      .refine(
        (items) =>
          new Set(items.map((item) => item.ingredient_id)).size ===
          items.length,
        "Enter each ingredient once.",
      )
      .optional(),
    baking_cost: money.optional(),
  }),
  transfer: z.object({ ...base, destination: id, quantity: qty }),
  receipt: z.object({
    ...base,
    transfer_id: id,
    quantity: z.number().int().nonnegative().max(1000000),
  }),
  return: z.object({ ...base, quantity: qty }),
  sale: z.object({
    ...base,
    quantity: qty,
    unit_price: money,
    amount_received: money,
    method: z.enum(["cash", "mobile_money", "credit"]),
    kind: z.enum(["retail", "wholesale"]),
    customer: z.string().max(120).default(""),
  }),
  payment: z.object({
    ...base,
    sale_id: id,
    amount: money.refine((n) => n > 0),
    method: z.enum(["cash", "mobile_money"]),
  }),
  bread_count: z.object({
    ...base,
    quantity: z.number().int().nonnegative().max(1000000),
  }),
  damage: z.object({ ...base, quantity: qty }),
  bread_adjustment: z.object({
    location_id: id.optional(),
    quantity: z
      .number()
      .int()
      .min(-1000000)
      .max(1000000)
      .refine((n) => n !== 0),
    notes: z.string().min(3).max(500),
  }),
  purchase: z.object({
    ...base,
    supplier: z.string().max(120).default(""),
    items: z
      .array(
        z.object({
          ingredient_id: id,
          quantity: z.number().int().positive().max(1000000000),
          cost: money,
        }),
      )
      .min(1)
      .max(30),
  }),
  ingredient_count: z.object({
    ...base,
    ingredient_id: id,
    quantity: z.number().int().nonnegative().max(1000000000),
  }),
  ingredient_adjustment: z.object({
    ...base,
    ingredient_id: id,
    quantity: z.number().int().min(-1000000000).max(1000000000),
    classification: z.enum([
      "estimated_production_use",
      "wastage",
      "spoilage",
      "measurement_discrepancy",
      "other",
    ]),
  }),
  expense: z.object({
    ...base,
    category: z.enum([
      "Transport",
      "Electricity",
      "Water",
      "Fuel",
      "Wages",
      "Repairs",
      "Packaging",
      "Other",
    ]),
    amount: money.refine((n) => n > 0),
  }),
  resolution: z.object({ event_id: id, notes: z.string().min(3).max(500) }),
  reversal: z.object({ event_id: id, notes: z.string().min(3).max(500) }),
};
export type EventType = keyof typeof payloads;
export type Role = "owner" | "manager" | "seller";
export interface Identity {
  user_id: string;
  bakery_id: string;
  role: Role;
  location_id: string;
  name: string;
}
export interface Ingredient {
  id: string;
  name: string;
  unit: string;
  scale: number;
}
export interface Location {
  id: string;
  name: string;
  kind: "bakery" | "seller";
}
export interface BusinessEvent {
  event_id: string;
  entity_id: string;
  device_id: string;
  event_type: EventType;
  schema_version: 1;
  payload: Record<string, any>;
  client_created_at: string;
  effective_at: string;
  user_id: string;
  bakery_id: string;
  location_id: string;
  server_seq?: number;
}
export function validate(type: EventType, payload: unknown) {
  const p = payloads[type].parse(payload);
  if (type === "sale") {
    const s = p as z.infer<typeof payloads.sale>;
    if (s.quantity * s.unit_price > 1000000000)
      throw new Error("Sale total must be at most UGX 1,000,000,000.");
    if (s.amount_received > s.quantity * s.unit_price)
      throw new Error("Payment cannot exceed the sale total.");
    if (s.amount_received < s.quantity * s.unit_price && !s.customer.trim())
      throw new Error("Enter a customer name for unpaid bread.");
    if (s.method === "credit" && s.amount_received !== 0)
      throw new Error("Choose cash or mobile money for a part payment.");
  }
  return p;
}
export function parseQuantity(text: string, scale: number): number {
  const value = text.trim();
  if (!/^-?\d+(?:\.\d{1,6})?$/.test(value))
    throw new Error("Enter a quantity such as 1 or 1.5.");
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace("-", "").split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole + fraction) * BigInt(scale);
  if (numerator % denominator !== 0n)
    throw new Error(
      "This ingredient cannot be measured that finely. Use a larger amount.",
    );
  const units = Number(numerator / denominator) * (negative ? -1 : 1);
  if (!Number.isSafeInteger(units) || Math.abs(units) > 1000000000)
    throw new Error("That quantity is too large.");
  return units;
}
export const ugx = (n: number) =>
  "UGX " + Math.round(n).toLocaleString("en-UG");
export const businessDate = (date: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(date));
export const displayTime = (date: string) =>
  new Intl.DateTimeFormat("en-UG", {
    timeZone: "Africa/Kampala",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(date));
export const managerTypes: EventType[] = [
  "production",
  "transfer",
  "purchase",
  "ingredient_count",
  "ingredient_adjustment",
  "expense",
  "bread_adjustment",
  "reversal",
];
const prorate = (amount: number, part: number, whole: number) =>
  whole > 0
    ? Number(
        (BigInt(amount) * BigInt(part) + BigInt(Math.floor(whole / 2))) /
          BigInt(whole),
      )
    : 0;
export function activeFacts(events: BusinessEvent[]) {
  const reversed = new Set(
    events
      .filter((e) => e.event_type === "reversal")
      .map((e) => e.payload.event_id),
  );
  return events.filter(
    (e) => e.event_type !== "reversal" && !reversed.has(e.event_id),
  );
}
export function report(events: BusinessEvent[]) {
  const ordered = [...events].sort(
    (a, b) =>
      a.effective_at.localeCompare(b.effective_at) ||
      a.client_created_at.localeCompare(b.client_created_at) ||
      (a.server_seq && b.server_seq ? a.server_seq - b.server_seq : 0) ||
      a.event_id.localeCompare(b.event_id),
  );
  const active = activeFacts(ordered);
  const resolved = new Set(
    active
      .filter((e) => e.event_type === "resolution")
      .map((e) => e.payload.event_id),
  );
  const stock: Record<string, number> = {},
    sales: Record<string, { total: number; paid: number; customer: string }> =
      {},
    transfers: Record<string, any> = {},
    ingredients: Record<string, { quantity: number; value: number }> = {};
  const batchCosts: Record<string, { total: number; perLoaf: number } | null> =
    {};
  let revenue = 0,
    cash = 0,
    purchases = 0,
    expenses = 0,
    produced = 0,
    wasted = 0,
    estimatedUse = 0;
  const discrepancies: string[] = [];
  const move = (l: string, n: number) => {
    stock[l] = (stock[l] || 0) + n;
  };
  for (const e of active) {
    const p = e.payload;
    switch (e.event_type) {
      case "production": {
        move(e.location_id, p.quantity);
        produced += p.quantity;
        let inputCost = 0;
        let fullyPriced = !!p.inputs?.length;
        for (const input of p.inputs || []) {
          const balance = ingredients[input.ingredient_id] || {
            quantity: 0,
            value: 0,
          };
          const available = Math.max(0, balance.quantity);
          const cost = prorate(
            balance.value,
            Math.min(input.quantity, available),
            available,
          );
          if (input.quantity > available || balance.value === 0)
            fullyPriced = false;
          inputCost += cost;
          balance.quantity -= input.quantity;
          balance.value -= cost;
          ingredients[input.ingredient_id] = balance;
        }
        estimatedUse += inputCost;
        expenses += p.baking_cost || 0;
        const total = inputCost + (p.baking_cost || 0);
        batchCosts[e.event_id] = fullyPriced
          ? { total, perLoaf: prorate(total, 1, p.quantity) }
          : null;
        break;
      }
      case "transfer":
      case "return":
        move(e.location_id, -p.quantity);
        transfers[e.entity_id] = {
          ...p,
          source: e.location_id,
          status: "pending",
        };
        break;
      case "receipt": {
        const t =
          transfers[p.transfer_id] ||
          active.find(
            (x) =>
              x.entity_id === p.transfer_id &&
              ["transfer", "return"].includes(x.event_type),
          )?.payload;
        if (t) {
          move(e.location_id, p.quantity);
          if (p.quantity !== t.quantity && !resolved.has(e.event_id))
            discrepancies.push(
              "Transfer " +
                p.transfer_id.slice(0, 8) +
                ": sent " +
                t.quantity +
                ", received " +
                p.quantity,
            );
          if (transfers[p.transfer_id])
            transfers[p.transfer_id].status =
              p.quantity === t.quantity ? "confirmed" : "disputed";
        }
        break;
      }
      case "sale": {
        const total = p.quantity * p.unit_price;
        move(e.location_id, -p.quantity);
        revenue += total;
        cash += p.amount_received;
        sales[e.entity_id] = {
          total,
          paid: p.amount_received,
          customer: p.customer,
        };
        break;
      }
      case "payment":
        cash += p.amount;
        break;
      case "damage":
        move(e.location_id, -p.quantity);
        wasted += p.quantity;
        break;
      case "bread_adjustment":
        move(e.location_id, p.quantity);
        break;
      case "bread_count":
        if (
          (stock[e.location_id] || 0) !== p.quantity &&
          !resolved.has(e.event_id)
        )
          discrepancies.push(
            "Bread count: expected " +
              (stock[e.location_id] || 0) +
              ", counted " +
              p.quantity,
          );
        break;
      case "purchase":
        for (const i of p.items) {
          const s = ingredients[i.ingredient_id] || { quantity: 0, value: 0 };
          s.quantity += i.quantity;
          s.value += i.cost;
          ingredients[i.ingredient_id] = s;
          purchases += i.cost;
        }
        break;
      case "ingredient_count": {
        const s = ingredients[p.ingredient_id] || { quantity: 0, value: 0 };
        if (s.quantity !== p.quantity && !resolved.has(e.event_id))
          discrepancies.push(
            "Ingredient count " +
              p.ingredient_id.slice(0, 8) +
              ": difference " +
              (p.quantity - s.quantity) +
              "; classify before costing",
          );
        break;
      }
      case "ingredient_adjustment": {
        const s = ingredients[p.ingredient_id] || { quantity: 0, value: 0 };
        const cost =
          s.quantity > 0
            ? prorate(s.value, Math.abs(p.quantity), s.quantity)
            : 0;
        if (p.classification === "estimated_production_use" && p.quantity < 0)
          estimatedUse += cost;
        s.quantity += p.quantity;
        s.value = Math.max(0, s.value + (p.quantity < 0 ? -cost : 0));
        ingredients[p.ingredient_id] = s;
        break;
      }
      case "expense":
        expenses += p.amount;
        break;
    }
  }
  for (const e of active.filter((e) => e.event_type === "payment"))
    if (sales[e.payload.sale_id])
      sales[e.payload.sale_id].paid += e.payload.amount;
  for (const [l, n] of Object.entries(stock))
    if (n < 0)
      discrepancies.push(
        "Stock " +
          l.slice(0, 8) +
          " is negative: " +
          n +
          " loaves. Review offline records.",
      );
  for (const [id, s] of Object.entries(ingredients))
    if (s.quantity < 0)
      discrepancies.push(
        "Ingredient " +
          id.slice(0, 8) +
          " has negative stock. Review purchases and classified use.",
      );
  for (const [id, t] of Object.entries(transfers)) {
    const receipt = active.find(
      (e) => e.event_type === "receipt" && e.payload.transfer_id === id,
    );
    if (receipt)
      t.status =
        receipt.payload.quantity === t.quantity ? "confirmed" : "disputed";
  }
  const allocated = active
    .filter((e) => e.event_type === "transfer")
    .reduce((sum, e) => sum + e.payload.quantity, 0);
  const inTransit = Object.values(transfers)
    .filter((t) => t.status === "pending")
    .reduce((sum, t) => sum + t.quantity, 0);
  const sold = active
    .filter((e) => e.event_type === "sale")
    .reduce((sum, e) => sum + e.payload.quantity, 0);
  const canEstimate =
    produced > 0 && estimatedUse > 0 && sold + wasted <= produced;
  const estimatedCostSold = canEstimate
    ? prorate(estimatedUse, sold, produced)
    : null;
  const estimatedWasteCost = canEstimate
    ? prorate(estimatedUse, wasted, produced)
    : null;
  const estimatedGross =
    estimatedCostSold === null ? null : revenue - estimatedCostSold;
  const estimatedNet =
    estimatedGross === null
      ? null
      : estimatedGross - expenses - (estimatedWasteCost || 0);
  const debt = Object.values(sales).reduce(
    (s, x) => s + Math.max(0, x.total - x.paid),
    0,
  );
  return {
    batchCosts,
    allocated,
    inTransit,
    sold,
    canEstimate,
    estimatedCostSold,
    estimatedWasteCost,
    estimatedGross,
    estimatedNet,
    stock,
    sales,
    transfers,
    ingredients,
    revenue,
    cash,
    purchases,
    expenses,
    produced,
    wasted,
    debt,
    estimatedUse,
    discrepancies,
    estimatedProductionMargin: revenue - estimatedUse - expenses,
  };
}
