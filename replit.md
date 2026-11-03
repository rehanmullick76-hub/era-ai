# ERA — AI Website Builder

ERA turns a natural-language request into an editable, multi-page website and
provides preview, code editing, testing, planning, design, chat, and security
review workflows.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080)
- `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/era run dev` — run the ERA web app
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (development only)
- Required env: `DATABASE_URL` — Postgres connection string
- AI generation also requires `GOOGLE_AI_API_KEY` in the workspace environment
- Workspace credential encryption requires `SESSION_SECRET`; Google OAuth creates first-party `era_session` cookies for app authentication.
- Payments require `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`. Current integration uses test-mode keys; never put their values in source.
- After adding the payment/generation tables to a fresh development database, run the development schema push before starting the API.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/era` — React/Vite frontend and builder experience
- `artifacts/api-server` — Express API, AI routes, auth middleware, credits, and Gemini integration
- `lib/db/src/schema` — Drizzle/PostgreSQL schema source of truth
- `lib/api-spec/openapi.yaml` — API contract source of truth
- `lib/api-client-react` — generated React Query hooks and custom fetch integration
- `lib/api-zod` — generated request/response schemas
- `scripts/normalize-zod-generated-imports.mjs` — keeps generated schemas on the workspace's `zod/v4` compatibility surface

## Architecture decisions

- ERA uses first-party Google OAuth only; guest sessions and guest account creation are disabled.
- AI credits are reserved and refunded on the server; local storage is display-only.
- Generation runs as a persisted server-side job. Reloading or stopping the browser's wait does not cancel that job; failed jobs refund their reserved credits.
- Razorpay orders use server-owned INR prices and persisted order ownership. Signature verification and captured-payment checks precede an atomic, idempotent credit award.
- Gemini models are discovered dynamically when available, filtered to text-capable models, and tried lightest-first for quota reliability.
- Project file saves use a database uniqueness constraint and atomic upsert on `(project_id, path)`.

## Product

- Create websites from a prompt, with multi-page output and shared assets.
- Inspect and edit generated files, preview pages, download a project ZIP, and deploy when ready.
- Ask ERA questions, generate an implementation plan, run code tests, request design suggestions, and run a security scan.
- Require a valid `era_session` cookie for the builder and all account-scoped API routes; public marketing pages remain available signed out.

## User preferences

No project-specific preferences recorded.

## Gotchas

- Run the ERA Vite build with `PORT` and `BASE_PATH` set, matching the workflow command.
- Run API codegen after OpenAPI changes; it also normalizes generated Zod imports and runs library typechecks.
- Development schema changes should use the DB development flow; production schema changes are applied through Publish.
- The preview iframe has a `null` origin because it uses `srcDoc`; navigation messages must include the component nonce.
- A standalone preview includes all HTML pages in an outer document; generated scripts remain in a sandboxed iframe.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
