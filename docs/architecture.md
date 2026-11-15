# Architecture

## Inspection and selection

The original directory contained only `prompt.txt` plus empty protected metadata directories. There was no frontend or business data to preserve. The enclosing Documents directory is a separate Git repository, so publishing must use an isolated project repository, never stage the parent directory.

Use the requested stack. A small SPA avoids a separate application server, containers and Edge Functions. PostgreSQL owns authentication-derived scope, validation, idempotency and normalized projections. Dexie owns offline durability. React owns simple forms and navigation. Supabase configuration uses public environment variables; no privileged frontend secret exists.

## Structure

- `src/domain.ts`: payload validation, integer money rules and deterministic ledger reports.
- `src/db.ts`: local records, append-only pending event creation and atomic pull/cursor application.
- `src/sync.ts`: small batches, explicit acknowledgments, rejection preservation and bounded retry delay.
- `src/api.ts`: Supabase sessions and RPC adapter.
- `src/main.tsx`: mobile home actions, account/onboarding, business forms, owner settings and recovery.
- `src/recovery.ts`: validated own-account recovery import.
- `scripts/service-worker.mjs`: build-specific complete shell precache, including dynamically loaded recovery code.
- `supabase/migrations`: normalized schema, RLS and checked RPCs.
- `tests`: real IndexedDB API tests using fake-indexeddb, embedded PostgreSQL tests, and Playwright production-browser tests.

## Data contract

A UUID event has a separate UUID entity, device UUID, event type, schema version 1, payload, UTC client/effective timestamps. The server derives user, bakery and stock location from the authenticated profile. Device IDs belong to exactly one bakery/account. Server sequences determine pull order; effective timestamps order business estimates and observations. Never use effective timestamps as sync cursors.

Every local save atomically inserts a readable record and pending event. Only accepted acknowledgments remove pending events. Downloaded canonical events replace their local copies by event UUID. Rejected records remain in the outbox and local database with a reason, excluded from operational totals. A corrected record uses a new UUID after review; accepted facts use reversals/adjustments. Owner discrepancy resolutions append a reason and retain the original observations.

## Stable cursor

A sequence alone is insufficient: concurrent PostgreSQL transactions can commit out of sequence. Push and pull serialize per bakery using a transaction advisory lock before sequence allocation/read. A pull can never advance over a still-uncommitted same-bakery event. Sequence gaps from rollbacks or other bakeries are safe. Page size is 100; push batch size is 25. Outgoing records are ordered by their references before batching: sales precede payments, handovers precede receipts, and original facts precede reversals/resolutions, regardless of UUID sort order. Each pull page and its cursor commit atomically on the phone. A maximum of 100 pages per run prevents a long catch-up from monopolizing a phone.

## Offline authentication

Sessions are in memory, not IndexedDB or localStorage. Reloading requires an online login to synchronize, but last-known identity/settings permit offline record entry. Server permissions always override cached permissions. A revoked role/device may create local records but upload is rejected visibly. Cached data is not encrypted and cannot be remotely erased from an offline phone.

## PWA updates

The build generates a hash-named shell cache and precaches all JS/CSS chunks. The current shell remains consistent until the new service worker activates after existing app windows close. Navigation uses the cached shell. Auth/API requests are never service-worker cached. HTTPS is required outside localhost.

## Implementation phases

1. Schema, checked data contracts and RLS: migrations run in PostgreSQL tests.
2. Account/onboarding, mobile actions, transactional IndexedDB and complete shell precache: persistence and atomic rollback tests; browser checks.
3. Push/pull, deduplication, rejection visibility and cursor protocol: interruption, pagination and three-device tests.
4. Production, handovers/confirmations, returns, sales and counts: domain and database tests.
5. Purchasing, classified stock differences, weighted-average estimates, expenses, credit and reports: calculation/payment tests.
6. Security review, recovery/deployment documentation and release checks: see validation.md for actual run results and unverified external dependencies.

## Deliberate limits

No exact recipe/batch costing, bank reconciliation, tax calculation, payroll ledger, aggregate sales entry, background sync while the app is closed, or automated billing. Historical data grows locally; archive and incremental report projections are future work if transaction volume outgrows this small-bakery design. The owner audit view shows the most recent 100 actions; full history stays in PostgreSQL.
