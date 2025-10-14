# AGENT INSTRUCTIONS

Welcome! This document captures the ground rules for working inside **grr**, a Slack-connected diary web app that runs on Cloudflare Workers with a React Router front-end.

## Project topology

- `/app` contains the Remix-style React Router app. Routes live under `app/routes`, shared UI lives under `app/components`, utilities under `app/lib`, and database/service helpers under `app/services`.
- `/app/slack-app` holds the Slack worker entry point (`app.ts`) plus handler modules under `handlers/` and Block Kit view builders under `handlers/views/`.
- `/workers` exposes the Cloudflare worker entry used for web requests, while Slack traffic is routed through `app/routes/webhook.slack`.
- Database migrations are in `/migrations` and must stay in lockstep with the TypeScript schema declared in `app/services/db.ts`.

## Tooling & commands

- Use **pnpm** for all scripts (see `package.json`). Frequently used commands:
  - `pnpm dev` for the local dev server.
  - `pnpm typecheck` (Cloudflare typegen + React Router typegen + `tsc -b`).
  - `pnpm lint` for Biome linting and `pnpm biome format --write .` to apply fixes.
  - `pnpm format` for a Prettier check and `pnpm format:fix` to rewrite the repo.
  - `pnpm db:migrate:local` / `pnpm db:migrate:remote` to apply D1 migrations locally or to the remote environment.
- コード変更を行ったら毎回、対象ファイルを Prettier で整形してから提出すること（例：`pnpm prettier --write <path>` や `pnpm format:fix -- <path>`）。
- Target Node 20+ tooling and Cloudflare Workers runtime APIs.

## TypeScript & React guidelines

- The repo is strictly typed (`strict: true` in `tsconfig.json`); avoid `any` and prefer precise types.
- Import app modules via the configured `~/` alias (e.g., `~/services/db`).
- Reuse shared utilities: use `dayjs` from `app/lib/dayjs.ts` for any date/time work so locale/timezone plugins stay applied.
- When adding React Router loaders/actions/components, follow the existing pattern of exporting `loader`/`action` and using the generated `Route.ComponentProps` types.
- UI components rely on Tailwind CSS v4 utility classes and helper components from `app/components/ui`; prefer composing those before introducing new design systems.

## Slack app guidelines

- Register new Slack commands, shortcuts, and views via `registerGrrHandlers` in `app/slack-app/handlers/grr.ts` or sibling modules; keep handler registration centralized in `app/slack-app/app.ts`.
- Encapsulate Block Kit structures in dedicated builder files inside `app/slack-app/handlers/views/` to keep handler logic concise.
- Use the provided Slack Web API client (`context.client`) and respect Slack rate limits (queue async work via `context.cloudflare.ctx.waitUntil` if needed for long tasks).

## Data access & persistence

- Interact with Cloudflare D1 through the shared Kysely instance exported from `app/services/db.ts`. Keep column names camelCased in TypeScript while matching snake_case in SQL migrations.
- When changing the database schema, update both the SQL migration files and the `Database` interface so type inference remains accurate. Run migrations through Wrangler (`wrangler d1 migration apply`).

## Testing & quality gates

- Ensure `pnpm typecheck` passes before committing.
- Run Biome linting (`pnpm biome check .`) when touching TypeScript/TSX files; apply fixes with `--apply` if necessary.
- Front-end changes that impact visuals should be previewed via `pnpm dev`; capture screenshots when modifying user-facing UI if feasible.

## Collaboration notes

- Favor descriptive commit messages and PR summaries that explain user-facing changes.
- Keep the “Hotaru diary” assistant tone friendly and empathetic in user copy or automated Slack messages.
- Mention in PR descriptions any environment limitations (e.g., inability to run Slack or Cloudflare emulators) that block testing.
