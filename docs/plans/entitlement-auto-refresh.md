# Entitlement Auto-Refresh

Make the cached entitlement JWT (`~/.arxa/entitlement.jwt`, 7-day TTL, minted only by
the `/activate` Edge Function) self-renewing for any user, with no hardcoded accounts
and no dev bypasses.

## Current state

- `lib/entitlement.dart` — verify-only: `Entitlement.verifyCurrent()`,
  `machineFingerprint()` (sha256 hex of per-OS machine id), 30-day offline grace,
  `entitlementAssertion()` is the single fail-closed paywall (scaffold boundary, D17).
- `lib/entitlement_cli.dart` — `arxa entitlement status|verify`; mint removed.
- `/activate` on project `nqvzhxcldntyayilykfy`: POST
  `{"fpr":"<sha256 hex>","platform":"macos|windows|linux"}` with Supabase user
  Bearer + `apikey` headers → `{"token":"<jws>"}` (200) or `{"error":...}` (4xx/5xx).
- No `http` package; `dart:io` `HttpClient` only. Tests use in-repo fixtures
  (`test/entitlement_fixture.dart`) and plain `test`/`group` style.

## Design

New module `lib/entitlement_refresh.dart`:

1. **`SupabaseConfig`** — `url` + `anonKey`. Defaults embedded for the official
   backend (`https://nqvzhxcldntyayilykfy.supabase.co` + published anon key — public
   by design); overridden by `ARXA_SUPABASE_URL` / `ARXA_SUPABASE_ANON_KEY` env so
   self-hosted backends work. Config is passed explicitly everywhere (tests point it
   at a loopback `HttpServer`).
2. **Session store** — `~/.arxa/session.json` mode 600 (chmod via `Process.runSync`
   on POSIX): `{access_token, refresh_token, expires_at}`. Load returns null on
   missing/corrupt file (never throws). Path injectable for tests.
3. **`arxa login`** — email + password (flag `--email` or prompt; password read with
   terminal echo off, plain line when stdin is not a tty) → Supabase
   `POST /auth/v1/token?grant_type=password` → persist session. Never prints tokens.
4. **Pure decision fn** — `refreshNeed(verdict, now, {window: 48h})` →
   `none | opportunistic | required`:
   - unlocks and `exp` further than 48h out → `none`
   - unlocks but `exp` within 48h (incl. grace status) → `opportunistic`
     (failures silent/non-fatal — offline tolerance)
   - does not unlock (none/invalid/expired-past-grace) → `required`
5. **`ensureFreshEntitlement(...)`** — orchestrator: check need → load session
   (missing session: no-op unless `required`) → refresh Supabase session via
   `grant_type=refresh_token` when access token is stale (or on a 401, once) →
   `POST /functions/v1/activate` with this machine's fingerprint → overwrite
   `entitlement.jwt` (600) only after the new token verifies for this machine.
6. **CLI wiring**:
   - `arxa entitlement refresh` — explicit/manual/CI form, honest JSON line out.
   - `bin/arxa.dart`: `arxa login` command; silent `await`ed opportunistic refresh
     before the two entitlement-gated dispatches (`emit`, `gate`). Never fatal there;
     sessionless free users (design/eject) see nothing. The existing
     `entitlementAssertion` stays the only fatal point; its hint gains
     "run `arxa login`".

## Tests (`test/entitlement_refresh_test.dart`)

- `refreshNeed` truth table (valid-far, valid-near, grace, expired, invalid, none).
- Session persistence: round-trip, mode 600 on POSIX, missing/corrupt → null.
- HTTP against loopback `HttpServer`: login persists session; refresh grant rotates
  tokens; activate writes a verifying token; 401 → one refresh+retry; network
  failure with still-valid token → non-fatal; failure with dead token → clear
  "run `arxa login`" outcome.
- All existing tests keep passing (`dart analyze` + `dart test`).

## Non-goals

- No client-side minting, no dev bypass, no token/password printing, no secrets in
  the repo (the anon key is a public client credential by definition).
