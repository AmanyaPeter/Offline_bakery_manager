# Git-connected deployment

The app builds to static files. Once the repository is connected, pushes deploy through the hosting provider without local deployment commands. Initial account/project creation and environment settings require access to your hosting and Supabase accounts.

## 1. Supabase

Create a Supabase project in your account. Keep its database password private. In project connection/API settings obtain the project URL and public anonymous/publishable key. Never use the service-role/secret key in frontend configuration.

Apply all files in `supabase/migrations/` in filename order using the SQL editor. Each file contains its own transaction. Alternatively install the Supabase CLI, authenticate, link the project and run `supabase db push`. Seed data is disabled; do not apply development seed data to production.

Enable email confirmation and configure email delivery appropriate for your users. Set the Auth Site URL to the final HTTPS app URL and allow only needed redirect URLs (include localhost for development only). Confirm the host URL before inviting users. Rate limits and email sending limits may require configuration in your Supabase project.

## 2. GitHub

Create/use an isolated `Bakery Manager` repository. Do not initialize or stage the parent Documents directory. This workspace's `.git` path may be managed/protected, so local initialization/commits can require explicit tool approval.

When GitHub CLI is available and authenticated:

```sh
git init -b main
git add .
git commit -m "Build offline bakery records and Supabase sync"
gh repo create bakery-manager --private --source=. --remote=origin --push
```

If a remote already exists, inspect it, then push normally. Never overwrite another repository or force-push. Review ignored files, run all validation and scan for secrets before publishing. `prompt.txt` is the specification; it contains no app secrets. Business exports and `.env` files must never be committed.

## 3. Frontend hosting

Vercel: import the GitHub repository, choose the Vite framework preset, set build command `npm run build`, output directory `dist`, and Node 22. Add:

```text
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-PUBLIC-KEY
```

`vercel.json` contains SPA rewrites and basic headers. Environment changes require a new build because Vite embeds public values at build time.

Netlify: import the repository; use `npm run build` and publish directory `dist`, Node 22 and the same environment variables. `_redirects` in public is copied to dist for SPA routing. Cloudflare Pages can use the same build/output settings; verify SPA fallback in its project settings.

Connect the production branch to automatic deployments. Use preview deployments for code review; point previews at a separate Supabase staging project. Do not let test users or development seed data reach the live bakery.

## 4. First owner and invitation

Open the deployed app online. Create an account and confirm its email. Sign in, create the bakery and enter your name. The transaction creates one owner, a central stock location and default price. Existing bakery users must join through a valid invitation; there is no public client-controlled role field.

In Owner administration configure ingredients, scales and default price. Invite managers/sellers by their exact confirmed email. Share their one-time code privately. Each seller gets an individual stock location when joining.

## 5. Android installation

Open the HTTPS app in Android Chrome/Brave, sign in and wait for its initial load/service-worker installation. Use the browser menu **Install app** or **Add to Home screen** (wording varies). Open the installed app, allow storage persistence, record a small test while airplane mode is on, close/reopen and check it remains. Reconnect, sign in, Sync and verify the waiting count reaches zero. Confirm on a second phone before entering live records.

## 6. Release acceptance

Run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, and `npm run test:e2e`. CI performs these checks and installs Chromium only in GitHub's test runner. For local Brave use `PLAYWRIGHT_BROWSER_PATH=/usr/bin/brave-browser` if automatic detection is insufficient.

Test real Supabase sign-in, email invitations, bakery isolation, two concurrent device connections, permission revocation, a partial payment, transfer dispute and a three-phone offline session. Review estimated profitability against a hand calculation. Export and restore a recovery file. See backup-recovery.md for free-tier/PITR and unsynchronized-record limits.
