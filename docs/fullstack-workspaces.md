# ERA full-stack development workspaces

## What is supported

New projects can choose **Frontend only** (the existing experience) or
**Full-stack**. Existing projects keep their original mode. Full-stack projects
generate HTML/CSS/vanilla JavaScript, an Express ES-module backend, a real
PostgreSQL CRUD API, numbered SQL migrations, package metadata, a placeholder
environment file, and setup instructions.

Full-stack **Preview** contains explicit Build/Start, Stop, Restart, Rebuild,
private-preview and workspace-deletion controls. Opening/reloading Preview never
starts paid compute implicitly. Generation and workspace operations are saved
server-side and can continue with the browser closed. An interrupted workspace
worker is reclaimed after its two-minute lease expires.

## Isolation and data

- Each project has a **different Daytona sandbox and Neon project**, including
  projects belonging to the same signed-in Google OAuth account.
- Builder access requires a valid first-party `era_session` cookie; guest sessions are disabled.
- Generated code runs only in the hosted sandbox, never as an ERA-host child
  process or local directory pretending to be an isolation boundary.
- The sandbox receives only its own runtime database URL, PORT and Node options.
  ERA's database, session secret, model keys, management keys and payment secrets
  are never mounted.
- Owner credentials are encrypted in the control database using authenticated
  encryption derived from SESSION_SECRET. Keep this key stable. Rotating it
  requires re-encrypting existing credentials first.
- The runtime PostgreSQL role receives CRUD/sequence privileges but not schema
  ownership. Migration credentials stay on the ERA control plane.
- Build installs ignore lifecycle scripts, only approved versioned dependencies
  are allowed, and every build uploads into a fresh random directory after
  stopping the old sandbox processes.
- Previews use expiring, single-port signed provider URLs on a separate origin.
  The provider's broader sandbox token and management key never reach the
  browser. Preview URLs are bearer capabilities: do not share them.
- Neon HTTPS SQL via `@neondatabase/serverless` is required in this free-tier
  runtime. Direct PostgreSQL TCP connections time out there. The control plane
  uses PostgreSQL TCP for validated migrations.
- Provider-enforced free-tier egress policy applies. Private/metadata address
  probes returned HTTP 403 during verification. Custom outbound allowlists are
  unavailable on this provider tier; no upgrade is performed.

## Persistence and deletion

Stopping/restarting a sandbox preserves its filesystem and external database.
Rebuilding source **does not recreate the database**. Migrations must be additive
and immutable once applied: add a new numbered migration instead of modifying
one that already ran. Supported statements are CREATE TABLE/INDEX IF NOT EXISTS
and ALTER TABLE ADD COLUMN. Foreign keys may specify ON DELETE SET NULL (not
CASCADE). Destructive/procedural SQL is rejected before a transaction runs.

Deleting a workspace requires explicit data-loss acknowledgement and deletes its
sandbox and Neon project, but retains generated source. Cleanup identifiers are
retained until each provider confirms deletion, so partial cleanup can be
retried. Delete the ERA source project only after workspace deletion succeeds.
Shared base-image caches are provider-managed; project runtime/database deletion
does not imply deleting a shared base image.

Source ZIPs include code, migrations and instructions, not runtime records,
database dumps, installed dependencies or credentials. `.env.example` is
rewritten with placeholders.

## Trial runtime billing and limits

This is a development preview, **not public production hosting**. Starting a
workspace consumes Daytona/Neon resources. Provider credits, paid billing and
automatic top-up follow the owner's provider-account settings. ERA does not read
wallet balances, change those settings, or require a recurring balance
confirmation. The owner manages provider credit use.

The development service needs DAYTONA_API_KEY and NEON_API_KEY plus:

```
ERA_RUNTIME_FREE_TRIAL_BUDGET_USD=5
ERA_RUNTIME_MAX_PROJECTS=3
```

The shared $5 reservation limit is ERA's internal ceiling, not a provider
wallet balance or actual-spend limit. It does not limit what Daytona or Neon
may bill under their account settings. ERA does not issue purchase or
auto-top-up requests.

Only Neon organizations reported as Free by its API are used. There are
no provider plan-upgrade, payment, purchase or automatic-top-up calls.

Safety limits:
- 1 CPU, 1 GiB RAM, 3 GiB disk per runtime.
- At most 3 provisioned projects globally and 2 per account.
- At most 1 running/building/queued workspace globally.
- 10-minute application lifetime, 5-minute provider idle stop and archive.
- Shared, persistent start/build budget: each attempt reserves 5 cents of the
  configured internal allowance. This is not an actual provider invoice or
  spending limit. Deleting a project does not reset it.
- Database quotas: 50 MB logical storage, 100 MB written/transfer, 3,600 CPU
  seconds and 14,400 active seconds per provider billing period.

Trial workspace availability is intentionally limited. These limits are not
sufficient for an unrestricted public launch. A production rollout needs a
separate capacity, funding, authentication, abuse and backup review.

## Developer verification

```
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push
pnpm --filter @workspace/api-spec run codegen
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/api-server typecheck
pnpm --filter @workspace/era typecheck
```

The control database push is for development; production schema rollout must be
reviewed separately. Start the configured ERA and API managed workflows rather
than starting a second listener on port 8080.

An opt-in real-provider integration script creates, exercises and deletes a
temporary full-stack project:

```
node artifacts/api-server/test/verify-workspace.mjs
```

It uses trial capacity and is **not** part of the normal unit-test command. It
checks real CRUD, stop/start data persistence, edit/rebuild preservation,
ownership, hostile paths and deletion confirmation.

Full-stack generation results are committed only on the server. Both normal
completion and browser reload recovery refresh saved source instead of replaying
file writes, preserving edits made in another tab after a job completed.

To additionally exercise the live Gemini generation path and build its actual
returned source, run `node artifacts/api-server/test/verify-live-generation.mjs`.
This uses scarce shared model quota as well as trial capacity. Job polling has a
separate read allowance and does not consume the model-call rate limit.
