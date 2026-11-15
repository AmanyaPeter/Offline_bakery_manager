# Security

## Trust boundary

Supabase verifies accounts. Profiles, devices and stock bindings are derived server-side. Roles and bakery ownership cannot be assigned by client table writes. Every business write uses a security-definer RPC with a fixed search path, restricted grants, role checks and bakery-scoped entity lookups. RLS protects every application table. Invitations are email-bound, expire and are consumed under a lock. Their raw tokens are returned only when created and should be shared privately.

The frontend uses only Supabase public URL/key. A public anonymous/publishable key is not a privileged secret; authorization depends on Auth and database rules. Never put a service-role key, database password, personal access token or JWT signing key in Vite variables, source files or Git. `.env*` files are ignored except `.env.example`.

## Offline risk

Authentication sessions are memory-only. No password, refresh token or custom long-lived bearer token is stored in IndexedDB/localStorage. Supabase renews a live session while the page is open. After reload, an online sign-in is needed for synchronization. Cached identity/settings allow continued offline entry; they are not an authorization credential.

Server role/device changes reject stale actions, retaining rejected records on the phone. Client location changes are not silently reassigned. Role changes preserve historical locations and reset the pull cursor on profile refresh. An offline revoked phone still has its downloaded data and can display cached screens. Server revocation cannot remotely erase it or prevent offline entry. A stolen unlocked phone can read local customer/business data. Use Android screen locks, individual user accounts, and privately stored recovery exports. Do not share accounts between phones owned by different people.

Signing out removes the cached active identity but retains records/outbox for recovery. The next user must never clear browser data before pending records have been recovered. IndexedDB is not encrypted at the application layer. Recovery files contain private business details and should be encrypted/stored using trusted device or backup facilities.

## Abuse and deployment

Configure Supabase email confirmation, SMTP, Auth rate limits and appropriate password settings. Push limits batch size, payload size and accepted records per hour; it is not a complete network abuse/WAF solution. Use HTTPS, restrict allowed Auth redirect URLs, pin dependencies through the lockfile and run dependency review on release. CORS is not authorization.

No service worker caches Supabase responses, Auth requests or external API content. UI text uses React escaping; it does not inject user HTML. Export import validates schema/account and re-queues records for server revalidation rather than trusting a file's claimed backup status.

## Validation scope

Embedded PostgreSQL tests execute real migrations, SQL role grants and RLS using a test Auth schema. They do not replace a hosted Supabase test with actual JWTs, email confirmation, production roles, PostgREST, TLS and simultaneous independent connections. Run those staging checks before production acceptance. The sequence protocol must be preserved in every future server-side event writer.
