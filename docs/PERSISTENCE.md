# Persistence (optional Postgres)

Default: **in-memory** (the public Render deploy — free, no database; state resets on restart/sleep).

With `DATABASE_URL` set, `apps/api/src/persistence.ts` (`PgPersistence`, node-postgres) uses the tables defined in `prisma/schema.prisma`:

1. Apply schema: `DATABASE_URL=… pnpm db:deploy` (= `prisma migrate deploy`, migration `prisma/migrations/0001_init`).
2. Boot: the API checks the tables exist, then hydrates users (non-expired), sessions (non-expired, non-revoked), devices and receipts into the in-memory Store.
3. Write-through: every authenticated request marks its user dirty; dirty users (user row + simulated ledger/sentinel/audit/voice snapshot in `User.state`, sessions, devices, receipts) are upserted in one transaction every 1.5 s, expired/removed guests are deleted (cascade), and a final flush runs on SIGTERM/close.
4. If the DB is unreachable or unmigrated at boot, the API logs a redacted warning and **falls back to in-memory**; `/v1/diagnostics → persistence` shows the mode.

Not persisted by design: raw session tokens (hashes only), 30 s confirmation tokens (single-use; die on restart), pairing codes (5 min), agent private keys (Mode D is disabled in the public deploy).

Tests: `apps/api/src/persistence.test.ts` — real Postgres round-trip (guest session, simulated fill, receipt, voice history survive a restart; old confirm token rejected after restart; no raw tokens in DB) when `STRIKE_TEST_DATABASE_URL` is set, plus an always-on unreachable-DB fallback test. Run locally against Postgres 17 on the box and in CI against a `postgres:17` service container.

Free hosting options if you want persistence in production (not provisioned — owner decision): Neon or Supabase free tiers; set `DATABASE_URL` on Render and run `pnpm db:deploy` once.
