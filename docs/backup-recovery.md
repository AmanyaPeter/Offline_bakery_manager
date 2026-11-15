# Backup and recovery

## Daily routine

At closing, connect every phone, sign in, press Sync and verify zero waiting and zero rejected records. A saved-on-phone transaction is not a cloud backup. Investigate rejected records before entering replacements. Export a recovery file on each phone with unsent records; store it privately away from that phone.

Persistent storage is requested through **Backup & phone safety**. Android/browser cleanup, device loss, storage failure, uninstall or origin changes can still erase IndexedDB. Installing the PWA does not make its data immune. Avoid incognito mode. Keep the same HTTPS domain: a new hostname is a different browser database.

## Replacing a phone

1. Synchronize the old phone if possible. If it is offline, export the recovery file first.
2. Install/open the same application domain on the replacement and sign in with the same account.
3. Synchronize to pull all accepted records. They are deduplicated by UUID.
4. Import the old recovery JSON under Backup & phone safety. Only the same account/bakery's events are restored. Existing UUIDs are skipped. Imported records are pending until the server validates/acknowledges them, even if the file claims they were backed up.
5. Synchronize. Already accepted events are acknowledged once. Rejected events remain visible. Importing does not bypass revoked device or current-role checks.
6. The owner can revoke the old device once recovery is complete. Revoking it first prevents its unaccepted events from uploading, including from the export. Such records require supervised manual re-entry as new events with explanatory notes and an audit/reconciliation review.

Do not edit JSON to manufacture accepted events, change ownership or reuse an event ID with changed content. Keep the original export for investigation. If a phone is lost with no export and records never synchronized, there is no server copy to recover. Use cash/physical counts and manual evidence to enter explicit audited adjustments; never fabricate a successful backup.

## Server backups

Keep migrations, application source and lockfile in GitHub. Git is not a backup of business records. Arrange regular encrypted PostgreSQL exports and safe storage of Supabase project/auth configuration. Back up Auth identities as well as application tables because profiles and events reference Auth users.

Do not assume a free Supabase project includes downloadable automatic backups or point-in-time recovery. Plan entitlements and retention change; check the actual project dashboard. A transaction after the newest retained backup may be lost on restore unless another device/export retains it. Test recovery on a separate project, including user identity mappings, RLS and event replay. Never test a destructive restore on production.

The append-only event ledger is the source for reports. Normalized projections must remain consistent with it. Do not truncate `sync_events` or reset sequence identities while devices hold cursors. A controlled recovery must reset affected local cursors (or use a new origin/local database after preserving exports) and re-pull all accessible events.
