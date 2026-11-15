# Database and RPC contract

Run migrations in lexical filename order. Seed data is separate and disabled by default. User-accessible tables have RLS; authenticated clients have no direct business write grants. Do not add broad write policies to make a UI error disappear.

## Tables

`bakeries`, `profiles` (one bakery per Auth user), `stock_locations`, `invitations` (hashed one-use tokens bound to email), `devices`, `ingredients`, `bakery_settings`, `expense_categories`, `production_batches`, `bread_transfers`, `transfer_confirmations`, `bread_stock_counts`, `bread_adjustments`, `customers`, `sales`, `payments`, `purchase_batches`, `purchase_items`, `ingredient_stock_counts`, `ingredient_adjustments`, `expenses`, `sync_events`, `sync_conflicts`, `audit_log`.

UUID entity keys support offline entry. UGX columns are bigint, bread counts integer, ingredient quantities scaled bigint. All event timestamps are timestamptz. Database check constraints and RPC validation reject fractional/negative values where inappropriate. Cross-bakery foreign-key ownership is validated before inserting server-derived rows. No frontend-supplied financial total is trusted.

## RPCs

- `create_bakery(bakery_name, person_name)`: authenticated unassigned user becomes the first owner. Creates central stock and price settings transactionally.
- `invite_user(invite_email, invite_role)`: owner-only, returns a random token once; stores only its SHA-256 hash. Roles are manager or seller, expiry seven days.
- `accept_invitation(invite_token, person_name)`: email-matched, unused, unexpired token; creates seller location if required. Tokens are row-locked while accepting.
- `owner_config(action, body)`: add ingredient, set default price, rename location, revoke a device, change non-owner role. Historical locations remain; reconcile stock before changing roles. Owners cannot remove or demote themselves through this RPC.
- `owner_overview()`: own-bakery users, devices and latest 100 audit actions.
- `push_events(batch)`: at most 25 event envelopes. Each event gets an accepted/sequence or rejected/reason acknowledgment. An exception rolls back all inserts/projections for that event while preserving accepted siblings. Exact retries are acknowledged once; conflicting UUID reuse is rejected. The entity ID is also unique.
- `pull_events(after_seq)`: ascending visible canonical events, `next_cursor`, `has_more`, 100 per page. Seller visibility is own events, incoming handovers and relevant reversals. Managers see their bakery. No visibility across bakeries.

Schema version is exactly 1. Introduce migrations and compatible clients before accepting a future version. Do not change old event payloads in place. Derived transfer status and sale void status are controlled mutable projections; their originating events remain immutable to clients.

## Transfer and count semantics

Sending moves bread out of the source into transit. Receiving adds only the observed quantity to destination stock. Unique `transfer_confirmations.transfer_id` prevents the same handover moving stock twice. Different quantities mark a dispute and create a conflict; no automatic loss is fabricated. Cancellation is an audited reversal of an unconfirmed handover. Confirmed transfers require explicit adjustments with reasons, never record replacement.

A physical count is an observation; it does not overwrite the stock ledger. Reports compare counts with effective-time facts. Late arrivals recompute the comparison. Different simultaneous counts stay separate. Negative ledger stock is displayed as a discrepancy instead of rejecting legitimate offline sales based on incomplete stock information.

## Operations

Tables/functions use fixed search paths and explicit function grants. Internal validation helpers are not exposed as public APIs. Supabase project administrators can inspect full tables via SQL editor; end users cannot bypass RPC checks. Maintain backups of the immutable event ledger and Auth user identities together. Rate protection includes a 25-record batch limit, payload size limit and 2,000 accepted records per user per hour; configure Supabase Auth protections separately.
