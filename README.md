# Bakery Manager

Mobile-first bread, ingredient, sales and credit records for a Ugandan bakery. React + TypeScript + Vite; Supabase Auth/PostgreSQL; Dexie/IndexedDB; installable PWA. All prices are whole UGX and displayed dates use Africa/Kampala.

## Develop

```sh
npm ci
cp .env.example .env
# Fill in the public Supabase URL and anonymous/publishable key.
npm run dev
```

Apply the SQL migrations to your own Supabase project before signing in. Without configuration the app displays setup instructions; it does not create a fake production account.

```sh
npm test
npm run typecheck
npm run build
npm run test:e2e
```

Playwright automatically uses `/usr/bin/brave-browser` if present. Otherwise install Chromium with `npx playwright install chromium`. Set `PLAYWRIGHT_BROWSER_PATH` to select another Chromium-compatible browser. E2E runs against the production build and checks an offline reload, not only a development server.

## How people work

1. Owner creates an account, confirms email, signs in and creates the bakery.
2. Owner invites a manager/seller by email and shares the one-use invitation code privately.
3. The invited person creates and confirms their account, signs in, then joins using that code.
4. Sign in once on each phone to download settings. Install the app and allow persistent storage under **Backup & phone safety**.
5. Record transactions even offline. **Saved on this phone** follows a committed IndexedDB transaction. **Backed up** requires a server acknowledgment.
6. Use **Sync now** when connected. After reopening the app, sign in again to back up. Offline records remain usable without a network login.
7. Review rejected records and stock differences. Correct accepted mistakes through reversal/adjustment; keep the original audit trail.

## Documentation

- [Architecture and phase record](docs/architecture.md)
- [Database and synchronization](docs/database.md)
- [Security and offline limitations](docs/security.md)
- [Costing and business rules](docs/accounting.md)
- [Backup and recovery](docs/backup-recovery.md)
- [Git-connected deployment](docs/deployment.md)
- [Validation and release limits](docs/validation.md)

The repository includes automated SQL tests using embedded PostgreSQL. A final staging test on hosted Supabase with real email delivery, multiple phones and authentication configuration remains necessary before business use. Never replace unsynchronized paper records until this is verified for the bakery.
# Offline_bakery_manager
