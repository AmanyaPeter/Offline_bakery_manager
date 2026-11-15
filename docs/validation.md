# Validation and release limits

## Completed in this workspace

- `npm test`: **33 tests passed** under Node 22.23.5 / Vitest 5.1.0.
- `npm run typecheck`: passed.
- `npm run build`: passed; also run by the browser test server.
- `npm run test:e2e`: **2 tests passed in installed Brave**, using the production build and a 390 × 844 mobile viewport.
- Online `npm audit --audit-level=high`: **0 reported vulnerabilities** after dependency updates.
- `git diff --check`: passed.
- Mobile home screenshot inspected; large text, readable contrast and full-width touch targets verified.
- Source selection excludes environment files, device exports, generated builds, dependencies and private metadata. A credential-pattern scan is performed before upload.

## Covered behavior

Offline save, restart persistence, transactional record/outbox rollback, invalid quantities, interrupted upload and exactly-once retry, acknowledgment handling, preserved permission rejections, cursor transaction rollback, safe recovery import, paginated pull, three independent local phone databases, concurrent local device initialization, and reference ordering for queued payments/reversals.

Real PostgreSQL migrations run in PGlite with a test Auth schema. Tests cover table RLS, direct-write denial, bakery isolation, server-derived ownership/location, exact and conflicting retries, seller permissions, device revocation, role changes, invitation email binding, whole-number validation, partial/later payments, receipt uniqueness, disputed transfers, idempotent returns, reversals, stale locations, owner discrepancy resolution and pagination over 100 records.

The three-device integration test routes actual Dexie outboxes through the SQL push/pull functions. Phone A records production and allocation; Phone B records receipt, offline sales and a later payment; Phone C records an ingredient purchase and bakery sale. Seven facts arrive exactly once, the remaining debt is correct, and both stock locations reconcile.

Calculation tests cover independent concurrent sales, late facts, conflicting physical counts, production, allocations without revenue, received quantities, returns, ingredient weighted-average use, separate purchase spending, operating expenses, estimated cost of sales/profit and auditable reversal. Decimal ingredient input converts through integer arithmetic; money input is always whole UGX.

Brave checks actual production service-worker caching, offline reload, a bread production entry, partial sale/payment reporting, ingredient entry in kg, readable local records and the required seller action order. Browser tests seed a non-credential cached test identity; they do not pretend to authenticate against a live Supabase project.

## Required before live business use

Apply migrations to a dedicated staging Supabase project and configure the public URL/key. Test real email confirmation, invitations, session renewal, JWT/PostgREST permissions and authorized report visibility. Repeat the offline three-phone exercise on physical Android devices, including a low-cost TECNO phone. Verify the per-bakery advisory-lock cursor protocol using separate simultaneous PostgreSQL connections; PGlite serializes its single connection and cannot prove this network/concurrency behavior by itself.

Configure the production HTTPS host/Auth URLs and test installation and recovery on the final domain. Review actual opening stock, ingredient scales, bread prices and costing estimates with the bakery owner. The default price is deliberately unset until supplied by the owner or entered on a sale. No Supabase service-role key is used by this application.

A live Supabase project and frontend host were not provisioned by these local tests. The repository is prepared for Git-connected deployment; infrastructure setup and the staging checks above remain separate acceptance steps. Build output includes harmless upstream Zod comment-annotation warnings; Rollup removes those annotations and completes successfully.
