# Phase 2: identity and security

## Local workflow

1. Start dependencies with `pnpm infra:up`.
2. Copy `.env.example` to `.env` and replace every secret or bootstrap value.
3. Apply immutable migrations with `pnpm db:migrate`.
4. Run `pnpm bootstrap:owner` once. It refuses to run after a tenant exists.
5. Open Mailpit at `http://localhost:8025`, verify the Owner email, then sign in at `http://localhost:3001/ca/login`.
6. Enable TOTP at `http://localhost:3001/ca/security`. Business endpoints reject privileged access until MFA is enabled.
7. Owners and administrators invite members from the same security page. In development, open the invitation in Mailpit; it expires after 48 hours and can only be used once.

TOTP enrollment renders the `otpauth://` secret as a QR locally in the browser. Control Hub does not send that secret to an external QR service. MFA is only considered enrolled after the user enters a valid first code; recovery codes are then shown once for offline storage.

Public email/password registration remains disabled. Account creation is available only through the one-use invitation endpoint, whose raw token is never persisted (only its SHA-256 digest is stored). Owner invitations are deliberately forbidden so ownership cannot be escalated through email.

The web application proxies `/api/*` to `http://127.0.0.1:4000` in development, preserving same-origin cookies. PostgreSQL RLS uses a transaction-local `app.tenant_id`; callers cannot provide authority through object identifiers. `x-control-hub-tenant` only selects one of the authenticated user's active memberships.

## Production requirements

- Use HTTPS at the reverse proxy and set `APP_ORIGIN` and `WEBAUTHN_ORIGIN` to the public HTTPS origin.
- Generate `BETTER_AUTH_SECRET` from at least 32 cryptographically random bytes.
- Keep PostgreSQL, Valkey and Mailpit/SMTP off public interfaces.
- Use different random values for `POSTGRES_ADMIN_PASSWORD` and `POSTGRES_APP_PASSWORD`; only the migration job receives the admin credential.
- Run migrations and bootstrap as one-off administrative jobs, never in the web container startup command.
- Back up the database and test restoration before onboarding production users.
