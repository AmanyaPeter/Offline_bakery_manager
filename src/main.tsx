import React, { useEffect, useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  useNavigate,
  useLocation,
} from "react-router-dom";
import { db, type Outgoing } from "./db";
import { supabase, rpc, transport } from "./api";
import { Synchronizer } from "./sync";
import {
  report,
  activeFacts,
  parseQuantity,
  ugx,
  displayTime,
  businessDate,
  type Identity,
  type BusinessEvent,
  type EventType,
  type Ingredient,
  type Location,
} from "./domain";
import "./style.css";
const sync = new Synchronizer(db, transport);
const titles: Record<EventType, string> = {
  production: "Baked Bread",
  transfer: "Give Bread to Seller",
  receipt: "Received Bread",
  return: "Return Bread",
  sale: "Sold Bread",
  payment: "Receive Payment",
  bread_count: "Count Bread Left",
  damage: "Damaged Bread",
  bread_adjustment: "Adjust Bread",
  purchase: "Bought Ingredients",
  ingredient_count: "Count Ingredients Left",
  ingredient_adjustment: "Classify Ingredient Difference",
  expense: "Expenses",
  resolution: "Resolve a Difference",
  reversal: "Correct a Record",
};
const actionIconPaths: Record<string, string> = {
  sale: "M5 8h14l1 12H4L5 8zm4 1V6a3 3 0 0 1 6 0v3",
  production:
    "M4 11a8 8 0 0 1 16 0c0 2-1 3-2 4v4H6v-4c-1-1-2-2-2-4zm5-1 1-2m3 2 1-2",
  transfer: "M3 7h17m-4-4 4 4-4 4M4 17h16m-12-4-4 4 4 4",
  receipt: "M4 12v7h16v-7M12 3v11m-4-4 4 4 4-4",
  balance: "M4 5h16v14H4zM4 11h16m-11 4h6",
  return: "M9 6 4 11l5 5m-5-5h11a5 5 0 0 1 5 5v3",
  records: "M6 3h9l3 3v15H6zM9 10h6m-6 4h6m-6 4h4",
  purchase: "M4 7h16v13H4zM8 7V4h8v3m-7 5h6",
  ingredient_count: "M9 4H5v17h14V4h-4m-6-1h6v4H9zm-1 11 3 3 5-6",
  expense: "M5 4h14v16l-3-2-4 2-4-2-3 2zm4 5h6m-6 4h6",
  reports: "M4 4v16h16m-12-4v-4m5 4V8m5 8V5",
};

function errorText(e: unknown) {
  if (e instanceof Error) {
    if (e.name === "ZodError")
      return "Check the form. Check the quantities, amounts, and required fields.";
    return e.message;
  }
  return "Something went wrong. Your unsaved form is still here.";
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function App() {
  const [identity, setIdentity] = useState<Identity | null>(null),
    [ready, setReady] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [authenticated, setAuthenticated] = useState(false),
    [records, setRecords] = useState<BusinessEvent[]>([]),
    [outbox, setOutbox] = useState<Outgoing[]>([]),
    [ingredients, setIngredients] = useState<Ingredient[]>([]),
    [locations, setLocations] = useState<Location[]>([]),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [syncing, setSyncing] = useState(false);
  const navigate = useNavigate(),
    path = useLocation().pathname.slice(1) || "home";
  async function refresh(i = identity) {
    if (!i) return;
    setRecords(await db.visible(i));
    setOutbox(
      (await db.outbox.toArray()).filter(
        (x) =>
          x.event.user_id === i.user_id && x.event.bakery_id === i.bakery_id,
      ),
    );
    setIngredients(
      (await db.get<Ingredient[]>("ingredients:" + i.bakery_id)) || [],
    );
    setLocations((await db.get<Location[]>("locations:" + i.bakery_id)) || []);
  }
  async function loadProfile() {
    if (!supabase) return null;
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .single();
    if (error || !data) return null;
    const i = data as Identity;
    const old = await db.get<Identity>("identity");
    if (
      old?.user_id === i.user_id &&
      (old.role !== i.role || old.location_id !== i.location_id)
    )
      await db.set("cursor:" + i.user_id, 0);
    await db.set("identity", i);
    setIdentity(i);
    const [ings, locs, settings] = await Promise.all([
      supabase.from("ingredients").select("*"),
      supabase.from("stock_locations").select("*"),
      supabase.from("bakery_settings").select("default_price").single(),
    ]);
    if (settings.data)
      await db.set("price:" + i.bakery_id, settings.data.default_price);
    if (ings.error || locs.error)
      throw new Error("Could not refresh bakery settings. Try Sync again.");
    await db.set("ingredients:" + i.bakery_id, ings.data);
    await db.set("locations:" + i.bakery_id, locs.data);
    await refresh(i);
    return i;
  }
  async function runSync(force = false) {
    if (!identity || !supabase || !authenticated || !navigator.onLine) return;
    setSyncing(true);
    try {
      const i = await loadProfile();
      if (!i)
        throw new Error(
          "Your bakery access could not be verified. Sign in again.",
        );
      await sync.run(i, force);
      await refresh(i);
      setError("");
    } catch (e) {
      setError("Backup paused: " + errorText(e));
    } finally {
      setSyncing(false);
    }
  }
  useEffect(() => {
    void (async () => {
      try {
        const cached = await db.get<Identity>("identity");
        if (cached) {
          setIdentity(cached);
          await refresh(cached);
        }
      } catch (e) {
        setError("This phone could not open its records: " + errorText(e));
      } finally {
        setReady(true);
      }
    })();
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!supabase) return;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthenticated(!!session);
      if (session)
        setTimeout(
          () => void loadProfile().catch((e) => setError(errorText(e))),
          0,
        );
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    void runSync();
    const timer = setInterval(() => void runSync(), 30000);
    const resume = () => {
      if (document.visibilityState === "visible") void runSync();
    };
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("focus", resume);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("focus", resume);
    };
  }, [identity?.user_id, authenticated, online]);
  const totals = report(records),
    pending = outbox.filter((x) => x.status === "pending"),
    rejected = outbox.filter((x) => x.status === "rejected");
  async function save(type: EventType, payload: unknown, effective: string) {
    if (!identity) return;
    setError("");
    try {
      await db.save(identity, type, payload, effective);
      await refresh();
      setMessage("Saved on this phone. Waiting for backup.");
      navigate("/home");
      void runSync(true);
    } catch (e) {
      setError(errorText(e));
      throw e;
    }
  }
  async function exportRecords() {
    download(
      "bakery-recovery-" + new Date().toISOString().slice(0, 10) + ".json",
      {
        version: 1,
        identity,
        records: await db.records.toArray(),
        outbox: await db.outbox.toArray(),
        exported_at: new Date().toISOString(),
      },
    );
    setMessage("Recovery file downloaded. Keep it somewhere safe.");
  }
  const seller = identity?.role === "seller";
  if (!ready)
    return (
      <main>
        <h1>Opening your records…</h1>
      </main>
    );
  return (
    <>
      <header>
        <div>
          <small>BAKERY MANAGER</small>
          <strong>{identity?.name || "Your bakery, together"}</strong>
        </div>
        {identity && <Link to="/home">Home</Link>}
      </header>
      <main>
        {identity && (
          <aside
            className={
              pending.length || rejected.length ? "status warning" : "status"
            }
            aria-live="polite"
          >
            <strong>
              {online ? "Online" : "Offline — you can keep working"}
            </strong>
            <span>
              {pending.length} waiting for backup · {rejected.length} need
              attention
            </span>
            {!pending.length && !rejected.length && (
              <span>All recorded transactions backed up</span>
            )}
            {!authenticated && (
              <Link to="/account">Sign in to back up this phone</Link>
            )}
            <button
              className="secondary"
              disabled={syncing || !authenticated || !online}
              onClick={() => void runSync(true)}
            >
              {syncing ? "Backing up…" : "Sync now"}
            </button>
          </aside>
        )}
        {message && (
          <div className="notice" role="status">
            {message}
            <button className="text" onClick={() => setMessage("")}>
              Dismiss
            </button>
          </div>
        )}
        {error && (
          <div className="error" role="alert">
            {error}
            <button className="text" onClick={() => setError("")}>
              Dismiss
            </button>
          </div>
        )}
        {!identity || path === "account" ? (
          <Account
            authenticated={authenticated}
            onReady={async () => {
              await loadProfile();
              navigate("/home");
            }}
            onError={setError}
            hasIdentity={!!identity}
          />
        ) : (
          <>
            {path === "home" && (
              <>
                <h1>What would you like to record?</h1>
                <section className="workbench" aria-label="Bakery balances">
                  <div className="stock-card">
                    <span>Bread at your location</span>
                    <strong>
                      {totals.stock[identity.location_id] || 0}{" "}
                      <small>loaves</small>
                    </strong>
                    <Link to="/balance">View bread stock</Link>
                  </div>
                  <dl className="money-card">
                    <div>
                      <dt>Money collected</dt>
                      <dd>{ugx(totals.cash)}</dd>
                    </div>
                    <div>
                      <dt>Customer credit outstanding</dt>
                      <dd>{ugx(totals.debt)}</dd>
                    </div>
                  </dl>
                </section>
                <nav className="actions">
                  {(seller
                    ? [
                        ["sale", "Sold Bread"],
                        ["receipt", "Received Bread"],
                        ["balance", "Bread Left"],
                        ["return", "Return Bread"],
                        ["records", "My Records"],
                      ]
                    : [
                        ["sale", "Sold Bread"],
                        ["production", "Baked Bread"],
                        ["transfer", "Give Bread to Seller"],
                        ["purchase", "Bought Ingredients"],
                        ["ingredient_count", "Count Ingredients Left"],
                        ["expense", "Expenses"],
                        ["reports", "Reports"],
                      ]
                  ).map(([url, title]) => (
                    <Link
                      key={url}
                      to={"/" + url}
                      className={url === "sale" ? "primary-action" : undefined}
                    >
                      <svg
                        className="action-icon"
                        viewBox="0 0 24 24"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d={actionIconPaths[url]} />
                      </svg>
                      {title}
                      <span aria-hidden="true">›</span>
                    </Link>
                  ))}
                </nav>
                {!seller && (
                  <Link className="block" to="/receipts">
                    Confirm returned bread
                  </Link>
                )}
                <Link className="block" to="/records">
                  Records, payments & corrections
                </Link>
                <Link className="block" to="/backup">
                  Backup & phone safety
                </Link>
                {identity.role === "owner" && (
                  <Link className="block" to="/admin">
                    Owner administration
                  </Link>
                )}
                <Link className="block" to="/account">
                  Account
                </Link>
              </>
            )}
            {path in titles && (
              <RecordForm
                key={path}
                type={path as EventType}
                records={records}
                ingredients={ingredients}
                locations={locations}
                identity={identity}
                save={save}
              />
            )}
            {path === "receipts" && (
              <RecordForm
                type="receipt"
                records={records}
                ingredients={ingredients}
                locations={locations}
                identity={identity}
                save={save}
              />
            )}
            {path === "balance" && (
              <>
                <h1>Bread Left</h1>
                <div className="summary">
                  <strong>
                    {totals.stock[identity.location_id] || 0} loaves
                  </strong>
                  <p>Expected from your records. Count the bread to check.</p>
                </div>
                <Link className="button" to="/bread_count">
                  Count Bread Left
                </Link>
                <Link className="block" to="/damage">
                  Record Damaged Bread
                </Link>
              </>
            )}
            {path === "records" && (
              <>
                <h1>{seller ? "My Records" : "Bakery Records"}</h1>
                <div className="links">
                  <Link to="/payment">Receive Payment</Link>
                  <Link to="/bread_count">Count Bread</Link>
                  <Link to="/damage">Damaged Bread</Link>
                  {!seller && (
                    <>
                      <Link to="/reversal">Correct a Record</Link>
                      {identity.role === "owner" && (
                        <Link to="/resolution">Resolve a Difference</Link>
                      )}
                      <Link to="/bread_adjustment">Adjust Bread</Link>
                      <Link to="/ingredient_adjustment">
                        Classify Ingredient Difference
                      </Link>
                    </>
                  )}
                </div>
                {rejected.map((x) => (
                  <article className="error" key={x.event_id}>
                    <strong>
                      Needs correction: {titles[x.event.event_type]}
                    </strong>
                    <p>{x.error}</p>
                    <p>
                      {displayTime(x.event.effective_at)} ·{" "}
                      {x.event_id.slice(0, 8)}
                    </p>
                    <p>
                      This record is kept on the phone and excluded from totals.
                      Contact the owner before entering a corrected record.
                    </p>
                  </article>
                ))}
                {[...records].reverse().map((e) => (
                  <article key={e.event_id}>
                    <strong>{titles[e.event_type]}</strong>
                    <p>
                      {displayTime(e.effective_at)} · {e.entity_id.slice(0, 8)}
                    </p>
                    <p>
                      {e.payload.quantity !== undefined
                        ? e.event_type.startsWith("ingredient_")
                          ? String(
                              e.payload.quantity /
                                (ingredients.find(
                                  (i) => i.id === e.payload.ingredient_id,
                                )?.scale || 1),
                            ) +
                            " " +
                            (ingredients.find(
                              (i) => i.id === e.payload.ingredient_id,
                            )?.unit || "") +
                            " "
                          : e.payload.quantity + " loaves "
                        : ""}
                      {e.event_type === "sale"
                        ? ugx(e.payload.quantity * e.payload.unit_price)
                        : ""}
                      {e.payload.amount ? ugx(e.payload.amount) : ""}
                    </p>
                    {e.event_type === "purchase" && (
                      <ul>
                        {e.payload.items.map((item: any, n: number) => {
                          const config = ingredients.find(
                            (i) => i.id === item.ingredient_id,
                          );
                          return (
                            <li key={n}>
                              {config?.name || "Ingredient"}:{" "}
                              {item.quantity / (config?.scale || 1)}{" "}
                              {config?.unit} · {ugx(item.cost)}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {e.payload.notes && <p>{e.payload.notes}</p>}
                    <small>
                      {e.server_seq ? "Backed up" : "Waiting for backup"}
                    </small>
                  </article>
                ))}
                {!records.length && <p>No records yet.</p>}
              </>
            )}
            {path === "reports" && !seller && (
              <Reports
                records={records}
                locations={locations}
                ingredients={ingredients}
                pending={pending.length}
              />
            )}
            {path === "backup" && (
              <>
                <h1>Keep your records safe</h1>
                <p>
                  {pending.length} records have not reached the server. Keep
                  this phone safe until they are backed up.
                </p>
                <p>
                  Browser or phone cleanup can erase local records, even when
                  persistent storage is allowed. Do not clear app data or
                  uninstall while backup is pending.
                </p>
                <button
                  onClick={() =>
                    void navigator.storage
                      ?.persist()
                      .then((ok) =>
                        setMessage(
                          ok
                            ? "Persistent storage allowed. Keep backing up regularly."
                            : "Storage could still be cleared. Back up and export regularly.",
                        ),
                      )
                  }
                >
                  Protect phone storage
                </button>
                <button
                  className="secondary"
                  onClick={() => void exportRecords()}
                >
                  Download recovery file
                </button>
                <label>
                  Restore recovery file
                  <input
                    type="file"
                    accept="application/json"
                    onChange={async (e) => {
                      try {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const { restore } = await import("./recovery");
                        const result = await restore(
                          db,
                          identity,
                          await file.text(),
                        );
                        await refresh();
                        setMessage(
                          "Restored " +
                            result +
                            " records. Sign in and sync to verify backup.",
                        );
                      } catch (err) {
                        setError(errorText(err));
                      }
                    }}
                  />
                </label>
                <p>
                  Recovery files contain customer and business details. Store
                  them privately. Restore only a file from your own account.
                </p>
              </>
            )}
            {path === "admin" && identity.role === "owner" && (
              <Admin
                onError={setError}
                onMessage={setMessage}
                refresh={loadProfile}
              />
            )}
          </>
        )}
      </main>
      <footer>Bakery Manager · UGX · Africa/Kampala</footer>
    </>
  );
}
function Account({
  authenticated,
  onReady,
  onError,
  hasIdentity,
}: {
  authenticated: boolean;
  onReady: () => Promise<void>;
  onError: (e: string) => void;
  hasIdentity: boolean;
}) {
  const [mode, setMode] = useState("signin"),
    [busy, setBusy] = useState(false),
    [info, setInfo] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!supabase) {
      onError(
        "Add Supabase settings using .env.example and the deployment guide.",
      );
      return;
    }
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      if (authenticated && mode !== "join") {
        await rpc("create_bakery", {
          bakery_name: f.get("bakery"),
          person_name: f.get("name"),
        });
        await onReady();
      } else if (mode === "join") {
        await rpc("accept_invitation", {
          invite_token: f.get("token"),
          person_name: f.get("name"),
        });
        await onReady();
      } else if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email: String(f.get("email")),
          password: String(f.get("password")),
        });
        if (error) throw error;
        setInfo("Check your email to confirm your account, then sign in.");
        setMode("signin");
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: String(f.get("email")),
          password: String(f.get("password")),
        });
        if (error) throw error;
        await onReady();
      }
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>
        {authenticated
          ? "Your bakery"
          : mode === "signup"
            ? "Create an account"
            : "Sign in"}
      </h1>
      {!supabase && (
        <p className="warning">
          Setup needed: configure the two public Supabase environment variables.
          See docs/deployment.md.
        </p>
      )}
      {info && <p role="status">{info}</p>}
      {hasIdentity && !authenticated && (
        <p>
          Your phone records remain available offline. Sign in with the same
          account to back them up.
        </p>
      )}
      <form onSubmit={submit}>
        {!authenticated ? (
          <>
            <label>
              Email
              <input name="email" type="email" autoComplete="email" required />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "signup" ? "new-password" : "current-password"
                }
                minLength={8}
                required
              />
            </label>
            <button disabled={busy}>
              {busy
                ? "Please wait…"
                : mode === "signup"
                  ? "Create account"
                  : "Sign in"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
            >
              {mode === "signup"
                ? "I already have an account"
                : "Create an account"}
            </button>
          </>
        ) : (
          <>
            {!hasIdentity && (
              <>
                <p>
                  Create your bakery once, or use the invitation from its owner.
                </p>
                <label>
                  Your name
                  <input name="name" required maxLength={120} />
                </label>
                <label>
                  Setup
                  <select
                    value={mode === "join" ? "join" : "create"}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="create">Create a bakery</option>
                    <option value="join">Join with invitation</option>
                  </select>
                </label>
                {mode === "join" ? (
                  <label>
                    Invitation code
                    <input name="token" required />
                  </label>
                ) : (
                  <label>
                    Bakery name
                    <input name="bakery" required maxLength={120} />
                  </label>
                )}
                <button disabled={busy}>
                  {busy
                    ? "Please wait…"
                    : mode === "join"
                      ? "Join bakery"
                      : "Create bakery"}
                </button>
              </>
            )}
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                await supabase?.auth.signOut();
                await db.meta.delete("identity");
                location.assign("/");
              }}
            >
              Sign out on this phone
            </button>
            <p>
              Signing out keeps unsent records on this phone. Export them before
              sharing or clearing the phone.
            </p>
          </>
        )}
      </form>
    </>
  );
}
function RecordForm({
  type,
  records,
  ingredients,
  locations,
  identity,
  save,
}: {
  type: EventType;
  records: BusinessEvent[];
  ingredients: Ingredient[];
  locations: Location[];
  identity: Identity;
  save: (t: EventType, p: unknown, e: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [lines, setLines] = useState(1),
    [unitPrice, setUnitPrice] = useState<number | string>(
      () =>
        [...records]
          .reverse()
          .find(
            (e) => e.event_type === "sale" && e.user_id === identity.user_id,
          )?.payload.unit_price ?? "",
    ),
    [quantity, setQuantity] = useState(0),
    [manualAmount, setManualAmount] = useState(""),
    [paidInFull, setPaidInFull] = useState(false),
    [paymentMethod, setPaymentMethod] = useState("cash"),
    [paymentSaleId, setPaymentSaleId] = useState("");
  const saleTotal = quantity * Number(unitPrice);
  const validFullAmount =
    Number.isInteger(saleTotal) && saleTotal > 0 && saleTotal <= 1000000000;
  const amountReceived =
    paymentMethod === "credit"
      ? "0"
      : paidInFull
        ? validFullAmount
          ? String(saleTotal)
          : ""
        : manualAmount;
  const saleBalance = Math.max(0, saleTotal - Number(amountReceived));
  const [formError, setFormError] = useState("");
  const reversed = new Set(
    records
      .filter((e) => e.event_type === "reversal")
      .map((e) => e.payload.event_id),
  );
  const transfers = records.filter(
    (e) =>
      ["transfer", "return"].includes(e.event_type) &&
      !reversed.has(e.event_id) &&
      (!e.payload.destination ||
        e.payload.destination === identity.location_id) &&
      e.location_id !== identity.location_id &&
      !records.some(
        (r) =>
          r.event_type === "receipt" && r.payload.transfer_id === e.entity_id,
      ),
  );
  const outstandingSales =
    type === "payment"
      ? Object.entries(report(records).sales).filter(
          ([, sale]) => sale.paid < sale.total,
        )
      : [];
  const paymentSale = outstandingSales.find(
    ([id]) => id === paymentSaleId,
  )?.[1];
  const paymentBalance = paymentSale ? paymentSale.total - paymentSale.paid : 0;
  const number = (
    name: string,
    label: string,
    min = 0,
    extra: Record<string, any> = {},
  ) => (
    <label>
      {label}
      <input
        name={name}
        type="number"
        inputMode="numeric"
        min={min}
        max={1000000000}
        step="1"
        required
        {...extra}
      />
    </label>
  );
  const ingredient = (name = "ingredient_id") => (
    <label>
      Ingredient
      <select name={name} required>
        <option value="">Choose an ingredient</option>
        {ingredients.map((i) => (
          <option key={i.id} value={i.id}>
            {i.name} ({i.unit})
          </option>
        ))}
      </select>
    </label>
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setFormError("");
    try {
      if (type === "sale" && paidInFull && !validFullAmount)
        throw new Error("Enter a valid sale total to use full payment.");
      const p: Record<string, any> = {};
      for (const [k, v] of f.entries()) p[k] = v;
      for (const k of ["quantity", "unit_price", "amount_received", "amount"])
        if (k in p) p[k] = Number(p[k]);
      const measured = (field: string, ingredientId: string) => {
        const config = ingredients.find((i) => i.id === ingredientId);
        if (!config) throw new Error("Choose an ingredient first.");
        return parseQuantity(String(f.get(field)), config.scale);
      };
      if (type === "purchase")
        p.items = Array.from({ length: lines }, (_, n) => {
          const ingredient_id = String(f.get("ingredient_" + n));
          return {
            ingredient_id,
            quantity: measured("quantity_" + n, ingredient_id),
            cost: Number(f.get("cost_" + n)),
          };
        });
      if (["ingredient_count", "ingredient_adjustment"].includes(type))
        p.quantity = measured("quantity", String(f.get("ingredient_id")));
      const date = String(f.get("effective"));
      delete p.effective;
      await save(type, p, new Date(date + ":00+03:00").toISOString());
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      type === "sale" &&
      !records.some(
        (e) => e.event_type === "sale" && e.user_id === identity.user_id,
      )
    )
      void db.get<number>("price:" + identity.bakery_id).then((p) => {
        if (typeof p === "number") setUnitPrice(p);
      });
  }, []);
  const localDate = new Date(Date.now() + 3 * 3600000)
    .toISOString()
    .slice(0, 16);
  return (
    <>
      <Link className="back" to="/home">
        ‹ Back home
      </Link>
      <h1>{titles[type]}</h1>
      {formError && (
        <p className="error" role="alert">
          {formError}
        </p>
      )}
      <form onSubmit={submit}>
        {[
          "production",
          "transfer",
          "return",
          "bread_count",
          "damage",
          "bread_adjustment",
          "receipt",
        ].includes(type) &&
          number(
            "quantity",
            type === "receipt"
              ? "Loaves actually received"
              : type === "bread_adjustment"
                ? "Change in loaves (use − for removal)"
                : "Number of loaves",
            type === "bread_adjustment"
              ? -1000000
              : ["bread_count", "receipt"].includes(type)
                ? 0
                : 1,
          )}
        {type === "bread_adjustment" && (
          <label>
            Stock location
            <select
              name="location_id"
              defaultValue={identity.location_id}
              required
            >
              {locations.map((l) => (
                <option value={l.id} key={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {type === "transfer" && (
          <label>
            Seller
            <select name="destination" required>
              <option value="">Choose a seller</option>
              {locations
                .filter((l) => l.kind === "seller")
                .map((l) => (
                  <option value={l.id} key={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        {type === "receipt" && (
          <>
            <label>
              Handover
              <select name="transfer_id" required>
                <option value="">Choose a handover</option>
                {transfers.map((t) => (
                  <option key={t.entity_id} value={t.entity_id}>
                    {t.entity_id.slice(0, 8)} · {t.payload.quantity} loaves ·{" "}
                    {displayTime(t.effective_at)}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Enter what you counted. A difference is kept for the owner to
              review.
            </p>
          </>
        )}
        {type === "sale" && (
          <>
            {number("quantity", "Loaves sold", 1, {
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                setQuantity(Number(e.target.value)),
            })}
            {number("unit_price", "Price of one loaf (UGX)", 0, {
              value: unitPrice,
              onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
                setUnitPrice(Number(e.target.value)),
            })}
            <div className="checkout-summary">
              <div>
                <span>Sale total</span>
                <strong>{ugx(saleTotal)}</strong>
              </div>
              <div>
                <span>Balance due</span>
                <strong>{ugx(saleBalance)}</strong>
              </div>
            </div>
            <label>
              Payment method
              <select
                name="method"
                value={paymentMethod}
                onChange={(event) => {
                  setPaymentMethod(event.target.value);
                  if (event.target.value === "credit") {
                    setPaidInFull(false);
                    setManualAmount("0");
                  }
                }}
              >
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile money</option>
                <option value="credit">Credit — no payment yet</option>
              </select>
            </label>
            <label className="check-option">
              <input
                type="checkbox"
                checked={paidInFull}
                disabled={
                  paymentMethod === "credit" ||
                  (!validFullAmount && !paidInFull)
                }
                onChange={(event) => setPaidInFull(event.target.checked)}
              />
              Use full sale total
            </label>
            {number("amount_received", "Money received now (UGX)", 0, {
              value: amountReceived,
              readOnly: paymentMethod === "credit" || paidInFull,
              max: Math.min(saleTotal, 1000000000),
              onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                setManualAmount(event.target.value),
            })}
            <label>
              Sale type
              <select name="kind">
                <option value="retail">Retail</option>
                <option value="wholesale">Wholesale</option>
              </select>
            </label>
            <label>
              Customer (required for unpaid bread)
              <input
                name="customer"
                maxLength={120}
                required={saleBalance > 0}
              />
            </label>
          </>
        )}
        {type === "payment" && (
          <>
            <label>
              Sale
              <select
                name="sale_id"
                required
                value={paymentSaleId}
                onChange={(event) => setPaymentSaleId(event.target.value)}
              >
                <option value="">Choose an unpaid sale</option>
                {outstandingSales.map(([id, sale]) => (
                  <option key={id} value={id}>
                    {sale.customer || "Customer"} · {id.slice(0, 8)} ·{" "}
                    {ugx(sale.total - sale.paid)} due
                  </option>
                ))}
              </select>
            </label>
            {paymentSale && (
              <p>Balance due on this phone: {ugx(paymentBalance)}</p>
            )}
            {!outstandingSales.length && <p>No unpaid sales on this phone.</p>}
            {number("amount", "Money received (UGX)", 1, {
              key: paymentSaleId,
              disabled: !paymentSale,
              max: paymentBalance,
            })}
            <label>
              Payment method
              <select name="method">
                <option value="cash">Cash</option>
                <option value="mobile_money">Mobile money</option>
              </select>
            </label>
          </>
        )}
        {type === "purchase" && (
          <>
            <p>
              Enter quantities in the unit shown next to the ingredient, such as
              1.5 kg or 2 litres.
            </p>
            {Array.from({ length: lines }, (_, n) => (
              <fieldset key={n}>
                <legend>Item {n + 1}</legend>
                {ingredient("ingredient_" + n)}
                {number(
                  "quantity_" + n,
                  "Quantity in the ingredient’s unit",
                  0,
                  { step: "any", inputMode: "decimal" },
                )}
                {number("cost_" + n, "Total paid for this item (UGX)")}
              </fieldset>
            ))}
            {lines < 30 && (
              <button
                type="button"
                className="secondary"
                onClick={() => setLines(lines + 1)}
              >
                Add another item
              </button>
            )}
            <label>
              Supplier (optional)
              <input name="supplier" maxLength={120} />
            </label>
          </>
        )}
        {["ingredient_count", "ingredient_adjustment"].includes(type) && (
          <>
            {ingredient()}
            {number(
              "quantity",
              type === "ingredient_count"
                ? "Quantity counted in the ingredient’s unit"
                : "Change in ingredient quantity (− for use or loss)",
              type === "ingredient_count" ? 0 : -1000000000,
              { step: "any", inputMode: "decimal" },
            )}
            {type === "ingredient_adjustment" && (
              <label>
                Reason
                <select name="classification">
                  <option value="estimated_production_use">
                    Estimated production use
                  </option>
                  <option value="wastage">Wastage</option>
                  <option value="spoilage">Spoilage</option>
                  <option value="measurement_discrepancy">
                    Measurement discrepancy
                  </option>
                  <option value="other">Other adjustment</option>
                </select>
              </label>
            )}
            <p>
              Counts do not automatically become production costs. Classify the
              difference separately after review.
            </p>
          </>
        )}
        {type === "expense" && (
          <>
            <label>
              Category
              <select name="category">
                {[
                  "Transport",
                  "Electricity",
                  "Water",
                  "Fuel",
                  "Wages",
                  "Repairs",
                  "Packaging",
                  "Other",
                ].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
            {number("amount", "Amount paid (UGX)", 1)}
            <p>
              Record ingredients under Bought Ingredients, so costs are counted
              once.
            </p>
          </>
        )}
        {type === "resolution" && (
          <>
            <label>
              Observation to resolve
              <select name="event_id" required>
                <option value="">Choose a count or handover</option>
                {records
                  .filter((r) =>
                    ["bread_count", "ingredient_count", "receipt"].includes(
                      r.event_type,
                    ),
                  )
                  .map((r) => (
                    <option key={r.event_id} value={r.event_id}>
                      {titles[r.event_type]} · {r.entity_id.slice(0, 8)} ·{" "}
                      {displayTime(r.effective_at)}
                    </option>
                  ))}
              </select>
            </label>
            <p>
              Review the count, record any necessary stock adjustments, and
              explain the decision. Both original observations stay in the audit
              trail.
            </p>
          </>
        )}
        {type === "reversal" && (
          <>
            <label>
              Record to reverse
              <select name="event_id" required>
                <option value="">Choose a record</option>
                {records
                  .filter(
                    (r) =>
                      !["reversal", "receipt", "resolution"].includes(
                        r.event_type,
                      ) && !reversed.has(r.event_id),
                  )
                  .map((r) => (
                    <option key={r.event_id} value={r.event_id}>
                      {titles[r.event_type]} · {r.entity_id.slice(0, 8)} ·{" "}
                      {displayTime(r.effective_at)}
                    </option>
                  ))}
              </select>
            </label>
            <p>
              The original stays in the audit trail. The server may require
              linked payments to be reversed first.
            </p>
          </>
        )}
        <label>
          {["reversal", "bread_adjustment", "resolution"].includes(type)
            ? "Reason for correction"
            : "Notes (optional)"}
          <textarea
            name="notes"
            maxLength={500}
            minLength={
              ["reversal", "bread_adjustment", "resolution"].includes(type)
                ? 3
                : undefined
            }
            required={["reversal", "bread_adjustment", "resolution"].includes(
              type,
            )}
          />
        </label>
        <label>
          When did this happen? (Kampala)
          <input
            name="effective"
            type="datetime-local"
            defaultValue={localDate}
            required
          />
        </label>
        <button disabled={busy}>
          {busy ? "Saving on this phone…" : "Save record"}
        </button>
        <p className="hint">
          Saved means stored on this phone. Backup is confirmed separately.
        </p>
      </form>
    </>
  );
}
function Reports({
  records,
  locations,
  ingredients,
  pending,
}: {
  records: BusinessEvent[];
  locations: Location[];
  ingredients: Ingredient[];
  pending: number;
}) {
  const facts = activeFacts(records),
    t = report(records),
    today = report(
      facts.filter(
        (e) =>
          businessDate(e.effective_at) ===
          businessDate(new Date().toISOString()),
      ),
    );
  const items = [
    ["Today’s sales", ugx(today.revenue)],
    ["Revenue, all records", ugx(t.revenue)],
    ["Money collected", ugx(t.cash)],
    ["Customer credit outstanding", ugx(t.debt)],
    ["Bread produced", t.produced + " loaves"],
    ["Bread allocated", t.allocated + " loaves"],
    ["Bread in transit", t.inTransit + " loaves"],
    ["Bread wasted", t.wasted + " loaves"],
    ["Ingredient purchases", ugx(t.purchases)],
    ["Estimated ingredient production use", ugx(t.estimatedUse)],
    ["Operating expenses", ugx(t.expenses)],
    ["Waiting for backup", String(pending)],
  ];
  return (
    <>
      <h1>Reports</h1>
      <p>
        Includes local records waiting for backup. Rejected records are
        excluded. Estimates depend on classified stock differences.
      </p>
      <dl>
        {items.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      <h2>Bread by location</h2>
      <dl>
        {locations.map((l) => (
          <div key={l.id}>
            <dt>{l.name}</dt>
            <dd>{t.stock[l.id] || 0} loaves</dd>
          </div>
        ))}
      </dl>
      <h2>Ingredient balances</h2>
      <dl>
        {ingredients.map((i) => (
          <div key={i.id}>
            <dt>{i.name}</dt>
            <dd>
              {(t.ingredients[i.id]?.quantity || 0) / i.scale} {i.unit}
            </dd>
          </div>
        ))}
      </dl>
      <p>
        Balances use purchases and classified adjustments. Physical counts
        remain separate observations.
      </p>
      <h2>Sales by seller</h2>
      {Array.from(
        new Set(
          records.filter((e) => e.event_type === "sale").map((e) => e.user_id),
        ),
      ).map((id) => (
        <p key={id}>
          {locations.find(
            (l) => l.id === records.find((e) => e.user_id === id)?.location_id,
          )?.name || id.slice(0, 8)}
          : {ugx(report(facts.filter((e) => e.user_id === id)).revenue)}
        </p>
      ))}
      <h2>Profit estimates</h2>
      <p>
        Revenue less estimated ingredient use and expenses:{" "}
        <strong>{ugx(t.estimatedProductionMargin)}</strong>.
      </p>
      <p>
        This is a production-period margin. Purchases are not subtracted again.
      </p>
      {t.canEstimate ? (
        <dl>
          {[
            ["Estimated production ingredient cost", t.estimatedUse],
            ["Estimated cost of bread sold", t.estimatedCostSold],
            ["Estimated gross profit", t.estimatedGross],
            ["Estimated net profit", t.estimatedNet],
          ].map(([k, v]) => (
            <div key={String(k)}>
              <dt>{k}</dt>
              <dd>{ugx(Number(v))}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p>
          Cost of bread sold and profit estimates need classified production use
          and enough recorded production first.
        </p>
      )}
      <p>
        Estimates spread all classified ingredient production costs equally
        across all recorded production. Net profit also subtracts operating
        expenses and the estimated ingredient cost of damaged bread. These are
        cumulative estimates, not exact batch costs.
      </p>
      <h2>Review differences</h2>
      {t.discrepancies.length ? (
        t.discrepancies.map((s, n) => (
          <p className="warning" key={n}>
            {s}
          </p>
        ))
      ) : (
        <p>No differences detected in downloaded records.</p>
      )}
    </>
  );
}
function Admin({
  onError,
  onMessage,
  refresh,
}: {
  onError: (e: string) => void;
  onMessage: (e: string) => void;
  refresh: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false),
    [token, setToken] = useState(""),
    [audit, setAudit] = useState<any[]>([]);
  async function submit(e: FormEvent<HTMLFormElement>, action: string) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    setBusy(true);
    try {
      if (action === "invite")
        setToken(
          await rpc<string>("invite_user", {
            invite_email: f.get("email"),
            invite_role: f.get("role"),
          }),
        );
      else {
        const body = Object.fromEntries(f);
        if ("scale" in body) (body as any).scale = Number(body.scale);
        if ("price" in body) (body as any).price = Number(body.price);
        await rpc("owner_config", { action, body });
      }
      await refresh();
      onMessage("Owner settings saved on the server.");
      form.reset();
    } catch (err) {
      onError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>Owner administration</h1>
      <p>Internet and a signed-in owner account are required.</p>
      <h2>Invite a user</h2>
      <form onSubmit={(e) => void submit(e, "invite")}>
        <label>
          Email
          <input name="email" type="email" required />
        </label>
        <label>
          Role
          <select name="role">
            <option value="seller">Seller</option>
            <option value="manager">Manager</option>
          </select>
        </label>
        <button disabled={busy}>Create invitation</button>
      </form>
      {token && (
        <div className="notice">
          <p>
            Share this code privately with the invited person. It expires in
            seven days.
          </p>
          <code>{token}</code>
        </div>
      )}
      <h2>Add ingredient</h2>
      <form onSubmit={(e) => void submit(e, "ingredient")}>
        <label>
          Name
          <input name="name" required maxLength={120} />
        </label>
        <label>
          Unit
          <input name="unit" placeholder="kg, litre, piece" required />
        </label>
        <label>
          Precision scale
          <input
            name="scale"
            type="number"
            min="1"
            max="1000000"
            step="1"
            defaultValue="1000"
            required
          />
        </label>
        <button disabled={busy}>Add ingredient</button>
      </form>
      <h2>Default bread price</h2>
      <form onSubmit={(e) => void submit(e, "price")}>
        <label>
          Price per loaf (UGX)
          <input
            name="price"
            type="number"
            min="0"
            max="1000000000"
            step="1"
            required
          />
        </label>
        <button disabled={busy}>Save default price</button>
      </form>
      <h2>Rename a location</h2>
      <form onSubmit={(e) => void submit(e, "location")}>
        <label>
          Location UUID
          <input name="location_id" required />
        </label>
        <label>
          Name
          <input name="name" required maxLength={120} />
        </label>
        <button disabled={busy}>Rename location</button>
      </form>
      <h2>Revoke a phone</h2>
      <form onSubmit={(e) => void submit(e, "revoke_device")}>
        <label>
          Device UUID
          <input name="device_id" required />
        </label>
        <button disabled={busy}>Revoke device</button>
      </form>
      <h2>Change user role</h2>
      <form onSubmit={(e) => void submit(e, "role")}>
        <label>
          User UUID
          <input name="user_id" required />
        </label>
        <label>
          Role
          <select name="role">
            <option value="seller">Seller</option>
            <option value="manager">Manager</option>
          </select>
        </label>
        <button disabled={busy}>Change role</button>
      </form>
      <h2>Audit trail</h2>
      <button
        className="secondary"
        onClick={async () => {
          try {
            setAudit(await rpc<any[]>("owner_overview"));
          } catch (e) {
            onError(errorText(e));
          }
        }}
      >
        Load users, devices and audit trail
      </button>
      {audit.map((row, n) => (
        <article key={n}>
          <pre>{JSON.stringify(row, null, 2)}</pre>
        </article>
      ))}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
if ("serviceWorker" in navigator && (import.meta as any).env.PROD)
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js");
  });
