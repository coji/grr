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
- **CRITICAL: Be cautious with fallback values using `||` or `??` operators.** When using fallbacks, ensure they are semantically equivalent alternatives (e.g., `url_private_download || url_private` where both serve the same purpose). If a field is truly required and has no valid alternative, fail explicitly with a clear error message rather than silently substituting an empty string or placeholder. Document why each fallback is safe.

## Cloudflare Workers environment variables

**Always use `import { env } from 'cloudflare:workers'` to access environment variables.**

```typescript
// ✅ CORRECT: Import env from cloudflare:workers
import { env } from 'cloudflare:workers'

const botToken = env.SLACK_BOT_TOKEN
const apiKey = env.GOOGLE_GENERATIVE_AI_API_KEY
```

```typescript
// ❌ WRONG: Don't use context.env or context.cloudflare.env
// These don't exist in the Slack handler context
const botToken = context.env.SLACK_BOT_TOKEN // Type error!
const botToken = context.cloudflare.env.SLACK_BOT_TOKEN // Type error!
```

**Why this matters:**

- Cloudflare Workers provides a global `env` object via the `cloudflare:workers` module
- This is the standard way to access bindings (environment variables, D1 database, etc.)
- The Slack handler `context` object does not include `env` or `cloudflare.env`
- See `app/services/db.ts` for the canonical example of this pattern

## Slack app guidelines

- Register new Slack commands, shortcuts, and views via `registerGrrHandlers` in `app/slack-app/handlers/grr.ts` or sibling modules; keep handler registration centralized in `app/slack-app/app.ts`.
- Encapsulate Block Kit structures in dedicated builder files inside `app/slack-app/handlers/views/` to keep handler logic concise.
- Use the provided Slack Web API client (`context.client`) and respect Slack rate limits (queue async work via `context.cloudflare.ctx.waitUntil` if needed for long tasks).

## AI prompting guidelines (Gemini 3 Flash)

AIプロンプトを追加・編集する際は、**[docs/gemini-3-prompting-guide.md](docs/gemini-3-prompting-guide.md)** を必ず参照してください。

### 重要なポイント

1. **簡潔に**: Gemini 3はreasoning modelなので、冗長なプロンプトは逆効果
2. **否定形を避ける**: 「〜するな」より「〜する」で指示
3. **出力フォーマットを明示**: 長さ、形式、トーンを具体的に
4. **ペルソナの使い分け**:
   - `getPersonaBackgroundShort()`: 単純なタスク（フォローアップ、マイルストーンなど）
   - `getPersonaBackground()`: 深い理解が必要なタスク（日記返信、振り返りなど）
5. **thinkingLevelの調整**:
   - `minimal`: 分類・抽出タスク
   - `low`: 要約・フォローアップ
   - `medium`: 日記返信・振り返り

### モデルごとの注意点

| モデル | thinkingLevel | 用途 |
|--------|---------------|------|
| `gemini-2.5-flash-lite` | ❌ 非対応 | 軽量タスク（テーマ生成など） |
| `gemini-3-flash-preview` | ✅ 対応 | 標準タスク |
| `gemini-3-pro-image-preview` | - | 画像生成専用 |

### プロンプト構造の統一

```typescript
## タスク
[具体的な指示]

## 出力フォーマット
- 形式: [散文/箇条書きなど]
- 長さ: [文字数/文数]
- トーン: [温かい/簡潔など]

## 例
[良い例のみ]
```

## File attachments in diary entries

The diary app supports file attachments (images, videos, documents) in diary entries via Slack messages.

### Architecture

- **Storage**: Files are referenced via Slack URLs (no separate file storage required)
- **Supported types**: Images (PNG, JPG, GIF, etc.), Videos (MP4, MOV, etc.), Documents (PDF, DOC, TXT, etc.)
- **Limit**: Maximum 10 files per diary entry (configurable via `MAX_ATTACHMENTS_PER_ENTRY` in `file-utils.ts`)
- **Database**: Attachments are stored in the `diary_attachments` table with metadata and Slack URLs

### Key files

- `app/services/attachments.ts` - Service for storing and retrieving attachments
- `app/slack-app/handlers/diary/file-utils.ts` - Utilities for file type detection and validation
- `migrations/0006_diary_attachments.sql` - Database schema for attachments

### Usage patterns

When a user posts a message with files in a diary thread:

1. Files are automatically detected in message/app_mention handlers
2. Supported files are filtered (via `filterSupportedFiles()`)
3. File metadata is extracted and stored in the database (via `storeAttachments()`)
4. Images are displayed inline in Block Kit views; other files shown as links

### Important notes

- **Column naming**: Due to CamelCasePlugin behavior, avoid underscores before numbers in SQL column names (e.g., use `slack_thumb360` not `slack_thumb_360`)
- **Slack URL for bot authentication**: **CRITICAL** - Do NOT use `url_private` from event payloads directly. Event payload URLs may contain stale/invalid file IDs. Always fetch fresh URLs via `files.info` API using the file ID before downloading. The API-provided `url_private` works with bot token authentication (`Authorization: Bearer <bot-token>` header) when `files:read` OAuth scope is present.
- **Slack URL limitations**: Files may become inaccessible if deleted from Slack or if the user leaves the workspace
- **Future migration**: The schema is designed to support future migration to R2 storage if needed

## Data access & persistence

- Interact with Cloudflare D1 through the shared Kysely instance exported from `app/services/db.ts`. Keep column names camelCased in TypeScript while matching snake_case in SQL migrations.
- When changing the database schema, follow these steps:
  1. Create a new SQL migration file in `/migrations/`
  2. Update the `Database` interface in `app/services/db.ts` so type inference remains accurate
  3. Run migrations through Wrangler (`wrangler d1 migration apply` or `pnpm db:migrate:local`)
- Integration tests **automatically detect and apply all migrations** from `/migrations` directory using Cloudflare's official `readD1Migrations()` and `applyD1Migrations()` APIs. No manual import needed when adding new migrations.

## Testing & quality gates

### Testing strategy

This project uses Vitest with three levels of testing:

1. **Unit tests** (`*.test.ts`): Fast tests for pure functions and business logic
   - Run with `pnpm test:unit` during development
   - Mock external dependencies (Slack API, Google AI, database)
   - Keep tests close to source files (e.g., `utils.test.ts` next to `utils.ts`)

2. **Integration tests** (`*.integration.test.ts`): Tests with real D1 database
   - Run with `pnpm test:integration` before committing
   - Use `@cloudflare/vitest-pool-workers` for D1 access
   - Test database operations and handler logic together
   - Mock external HTTP APIs via MSW

3. **E2E tests**: Not recommended for this project
   - E2E tests are complex to maintain in Cloudflare Workers environment
   - Instead, write comprehensive integration tests that cover critical paths
   - Manual testing via `pnpm dev` for UI changes

### Test commands

- `pnpm test:unit` - Run unit tests only (fast)
- `pnpm test:integration` - Run integration tests with D1
- `pnpm test:all` - Run all tests (use before creating PRs)
- `pnpm test:coverage` - Generate coverage reports
- `pnpm test:ui` - Run tests with Vitest UI

### Writing tests

- **Mock utilities** are available in `__mocks__/` directory:
  - `__mocks__/slack.ts` - Slack Web API client mocks
  - `__mocks__/ai.ts` - Google AI SDK mocks
  - `__mocks__/db.ts` - Database query builder mocks
- **MSW handlers** for HTTP mocking are in `tests/setup/msw-handlers.ts`
- Follow existing test patterns for consistency
- Prefer testing behavior over implementation details
- Aim for 70-80% coverage on business logic, not 100%
- Skip coverage on routes, type definitions, and Block Kit view builders

### Path aliases in tests

**Important**: Integration tests require special configuration for path aliases (`~/`) to work correctly.

**Why this is needed:**

- Unit tests run in standard Node.js environment where `vite-tsconfig-paths` plugin works normally
- Integration tests run in Cloudflare Workers runtime (Miniflare/Workerd) which has different module resolution
- `@cloudflare/vitest-pool-workers` creates an isolated runtime where Vite plugins don't fully propagate to the execution environment

**Current solution:**

1. `vitest.integration.config.ts` - Define both `plugins: [tsconfigPaths()]` AND `resolve.alias: { '~': path.resolve(__dirname, './app') }`
2. `tests/tsconfig.json` - Must re-declare `baseUrl` and `paths` even when extending parent tsconfig (TypeScript limitation)

**Root cause:** When `defineWorkersConfig` processes plugins, the Workers runtime uses a separate module resolver that doesn't fully inherit Vite's plugin-based path resolution. The manual `resolve.alias` ensures paths work at runtime, while `vite-tsconfig-paths` helps during the build/transform phase.

### Quality gates

- Ensure `pnpm typecheck` passes before committing.
- Run `pnpm test:unit` during development for quick feedback.
- Run `pnpm test:all` before creating pull requests.
- Run Biome linting (`pnpm biome check .`) when touching TypeScript/TSX files; apply fixes with `--apply` if necessary.
- Front-end changes that impact visuals should be previewed via `pnpm dev`; capture screenshots when modifying user-facing UI if feasible.

## Git workflow

**CRITICAL: Never commit directly to the `main` branch.**

### Branch naming conventions

- Feature branches: `feat/description` (e.g., `feat/diary-file-attachments`)
- Bug fixes: `fix/description` (e.g., `fix/mime-type-validation`)
- Refactoring: `refactor/description`
- Documentation: `docs/description`

### Development workflow

1. **Always create a feature branch** from `main` before making changes:

   ```bash
   git checkout main
   git pull
   git checkout -b feat/your-feature-name
   ```

2. **Make commits to the feature branch**:

   ```bash
   git add -A
   git commit -m "descriptive message"
   git push -u origin feat/your-feature-name
   ```

3. **Create a pull request** when ready:

   ```bash
   gh pr create --title "feat: description" --body "..."
   ```

4. **Merge via pull request** - never push directly to `main`

### Emergency hotfixes

Even for urgent fixes, **always use a branch**:

```bash
git checkout -b fix/urgent-issue
# make changes
git commit -m "fix: urgent issue"
git push -u origin fix/urgent-issue
gh pr create --title "fix: urgent issue"
```

## 作業完了時のチェックリスト

ひとまとまりの作業が終わったら以下を必ず実行する。

1. **AIプロンプトレビュー**: プロンプトを追加・編集した場合、[プロンプトガイド](docs/gemini-3-prompting-guide.md)に照らして確認
2. **ユニットテスト**: 変更したビジネスロジックにテストを追加し `pnpm test:unit` を通す
3. **リファクタリング**: 凝集度を高く、結合度を低く、重複を排除して整理する

## Collaboration notes

- Favor descriptive commit messages and PR summaries that explain user-facing changes.
- Keep the "Hotaru diary" assistant tone friendly and empathetic in user copy or automated Slack messages.
- Mention in PR descriptions any environment limitations (e.g., inability to run Slack or Cloudflare emulators) that block testing.
