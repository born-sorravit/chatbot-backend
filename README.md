# chatbots-backend

NestJS 12 · TypeScript 6 · PostgreSQL 17 + pgvector · TypeORM 1 · Redis · Socket.IO (Phase 2)

## Scope so far

**Phase 1** — Organization · User · Auth (JWT + rotating refresh) · RBAC ·
Customer · migrations · Redis · configuration.
**Phase 2** — Conversation · Message · customer chat API · admin inbox API ·
two WebSocket namespaces · unread counters · typing.
**Phase 3** — AI Agent · LLMProvider (Anthropic + stub) · orchestrator ·
BullMQ worker · conversation context · prompt assembly · structured output ·
handoff · token/cost logging.
**Phase 4** — Knowledge bases · document ingestion (text/markdown/FAQ/PDF/URL) ·
Thai-aware chunking · EmbeddingProvider (Voyage + offline lexical) · pgvector
HNSW retrieval · grounded prompts · retrieval debugger.
**Phase 5** — Take Over · Return to AI · customer-initiated handoff ·
per-reason handoff tracking · admin notifications over REST and WebSocket.
**Phase 6** — Tool registry · per-agent allowlist · Zod input validation ·
approval gate · execution logging · audit log · 3 read-only business tools.
**Phase 7** — Conversation, resolution, handoff and response-time metrics ·
token and cost reporting · two endpoints behind two different permission gates.
No migration: it aggregates the existing tables (ARCHITECTURE TD-40).
**Phase 8** — Channel adapter abstraction · LINE, Facebook Messenger and
WhatsApp · signed public webhooks · inbound idempotency · outbound delivery
through BullMQ · per-integration credentials that the API never returns.
The provider HTTP calls are unverified against the live APIs (TD-53).

All eight phases are built — see [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md) §11.

## Setup

```bash
nvm use                # Node 24.21.0 — see "Node version" below
cp .env.example .env   # then fill JWT_SECRET and JWT_REFRESH_SECRET
npm install
npm run migration:run
npm run seed:run
npm run start:dev
```

Generate the two secrets separately — they must differ (nothing checks this at
boot, so it is on you):

```bash
openssl rand -base64 48
```

## Scripts

| Script | Purpose |
| --- | --- |
| `build` | `nest build` → `dist/` (uses `tsconfig.build.json`, which excludes `test/` and specs) |
| `start:dev` / `start:debug` | Watch mode (`NODE_ENV=development`) / with the inspector |
| `start:prod` | `node dist/main` with `NODE_ENV=production` |
| `format` | Prettier over `src/**/*.ts` |
| `lint:check` / `lint:fix` | Prettier check / write over the whole project |
| `eslint:check` / `eslint:fix` | ESLint (flat config) over `src` and `test` |
| `typecheck` | `tsc --noEmit` |
| `test` | Unit tests |
| `test:e2e:setup` | Migrate the dedicated e2e database (run once) |
| `test:e2e` | Auth, RBAC, isolation, chat, realtime and AI against real Postgres + Redis. Uses its own database *and* its own Redis queue prefix, so it is safe to run while `start:dev` is up |
| `migration:run` / `migration:revert` | Schema migrations |
| `migration:create` | New **empty** migration file to fill in by hand: `npm run migration:create --name=NNN-Name` |
| `typeorm` | Raw TypeORM CLI, e.g. `npm run typeorm -- migration:show -d ./src/shared/database/typeorm.config.ts` |
| `seed:run` | Idempotent development seed |

## Layout

```
src/
├── config/          configuration.ts — env → typed config object, read via ConfigService
├── models/          TypeORM entities + repositories, one folder per domain
│   ├── <domain>/entities/*.entity.ts
│   ├── <domain>/*.repository.ts
│   ├── base.entity.ts · tenant-scoped.repository.ts (tenant scoping)
│   ├── entities.ts   explicit ENTITIES list + barrel
│   └── model.module.ts  @Global — provides the custom repositories
│                     (knowledge-base/embeddings.repository.ts is the only
│                      place touching the pgvector column)
├── shared/          cross-cutting code, @Global SharedModule
│   ├── database/    typeorm.config · migrations · seeds
│   ├── redis/       shared ioredis client
│   └── guards · decorators · filters · interceptors · middleware
│       · constants (RBAC) · interfaces · throttling
└── modules/
    ├── auth/          login · rotating refresh · logout · JWT strategy
    ├── users/         user CRUD, RBAC-gated
    ├── organizations/ tenant root
    ├── customers/     tenant-scoped customer CRUD
    ├── ai/            providers · context · prompts · rag · orchestrator · usage
    ├── documents/     extraction · chunking · ingestion pipeline
    ├── knowledge-base/ KB + document CRUD, retrieval debug endpoint
    ├── notifications/ per-user admin notifications
    ├── tools/         registry, permission checks, execution, admin API
    ├── audit/         security audit log (§42)
    ├── analytics/     SQL aggregates for metrics and cost (no rollup table)
    ├── channels/      adapters (LINE/FB/WhatsApp) · webhooks · delivery · admin API
    ├── ai-agents/     agent CRUD, RBAC-gated, plus the dry-run test endpoint
    ├── queue/         BullMQ wiring and the ai-response producer
    ├── workers/       BullMQ processors (registered unless APP_ROLE=api)
    ├── chat/          customer surface: session, send, history, typing
    ├── conversations/ admin surface: inbox, reply, assign, close
    ├── messages/      the single transactional write path for every message
    ├── websocket/     two gateways · RealtimeService · Redis adapter
    └── health/        DB + Redis liveness
```

Imports use the `@/` alias (`@/models/...`, `@/shared/...`, `@/modules/...`);
same-folder imports stay relative. `nest build` rewrites the aliases in `dist/`,
Jest maps them through `moduleNameMapper`, and ts-node (the TypeORM CLI and
`seed:run`) resolves them via the `ts-node` section of `tsconfig.json`.

### Where things go

| Adding… | Put it in | Then |
| --- | --- | --- |
| An entity | `models/<domain>/entities/<name>.entity.ts` | Export it from `models/entities.ts` **and** add it to `ENTITIES` there — the list is explicit on purpose, so the abstract bases are never registered. Write the migration by hand (see below) |
| A repository | `models/<domain>/<name>.repository.ts` | Add it to `repositories` in `models/model.module.ts`. It is global, so feature modules inject it without registering it. Tenant-owned tables extend `TenantScopedRepository` |
| A feature | `modules/<feature>/` — module, controllers, services, `dto/` | Import the module in `app.module.ts` |
| Cross-cutting code | `shared/` — guards, decorators, filters, interceptors, middleware, constants, interfaces | — |
| A config value | `config/configuration.ts` | Add the field to the section interface and read it from `process.env` with a default. Consume it with `ConfigService` |

## Configuration

`src/config/configuration.ts` turns the environment into one typed, nested
object, loaded by `ConfigModule.forRoot({ isGlobal: true, load: [configuration] })`.
Sections: `app`, `database`, `redis`, `security`, `llm`, `embedding`, `rag`,
`ai`, `rateLimit`. Read values through `ConfigService`:

```ts
constructor(private readonly config: ConfigService) {}

this.config.getOrThrow<string>('security.jwt.secret');   // one value
this.config.getOrThrow<RagConfig>('rag');                // a whole section
this.config.get<number>('rag.maxDistance');              // optional value
```

**Nothing is validated at boot.** Every key falls back to a default
(`process.env.X || 'default'`), so a typo in `.env` shows up as default
behaviour, not a startup error. Things to get right yourself:

- `JWT_SECRET` and `JWT_REFRESH_SECRET` must be set, and must differ. An empty
  `JWT_SECRET` does stop boot, but only because passport-jwt refuses it
  ("JwtStrategy requires a secret or key"). Nothing checks their length or
  whether they match.
- `RAG_CHUNK_OVERLAP` must be smaller than `RAG_CHUNK_TOKENS`, or chunking
  cannot advance.
- `LLM_PROVIDER=anthropic` without `LLM_API_KEY` (and likewise
  `EMBEDDING_PROVIDER=voyage` without `EMBEDDING_API_KEY`) leaves that provider
  inactive — logged at startup — rather than refusing to boot.

The TypeORM CLI does not boot Nest: `shared/database/typeorm.config.ts` loads
`.env` with dotenv and calls `configuration()` directly.

## Tenant isolation

Four layers (`../docs/DATABASE.md` §4). The one that does the real work is
`TenantScopedRepository` (`models/tenant-scoped.repository.ts`): every method
takes `organizationId` as its first positional argument, so forgetting the
filter is a compile error rather than a silent full-table read. Cross-tenant
access returns **404, never 403** — a 403 would confirm the row exists.

`organizationId` always comes from the verified token, never from a request body,
query string or path parameter.

## Things worth knowing

**Node version.** Pinned to 24.21.0 in `.nvmrc`. NestJS 12 ships ESM, and Jest can
only `require` it on Node ≥ 24.9. On Node 22 every suite that imports
`@nestjs/common` fails to load. The test scripts also pass
`NODE_OPTIONS=--experimental-vm-modules`, which Jest needs to expose
`vm.SourceTextModule`.

**TypeScript 6, not 7.** NestJS 12's schematics require `>=6`; ts-jest supports
`<7`. Six is the only version satisfying both.

**Rate limiting.** Two named throttlers are configured, and *every* configured
throttler is evaluated on *every* route — so the strict auth limiter explicitly
opts out of non-auth routes via `skipIf`. Without that, the whole API silently
inherits the 5-requests-per-minute brute-force limit. `AUTH_RATE_LIMIT_MAX` is 5
in `.env.example`; local `.env` uses a higher value so repeated manual testing
doesn't lock you out. The window is in-memory, so restarting the API clears it.

**Migrations are hand-written. Do not use `migration:generate`.** There is
deliberately no script for it. TypeORM's generator works from entity metadata, so it
silently cannot express several things this schema depends on:

- `CREATE EXTENSION` — `citext`, `pgcrypto`, `vector`. A generated migration uses
  the `citext` type without ever creating the extension, so it fails on a fresh
  database.
- Enums with no entity yet. Migration 001 creates all 11 up front; a generator
  emits only the ones currently referenced, so later phases have nothing to point
  at.
- Partial index predicates — `WHERE revoked_at IS NULL`,
  `WHERE email IS NOT NULL`, and the `ux_msg_ai_trigger` index that makes
  duplicate AI replies impossible.
- The pgvector HNSW index arriving in Phase 4.

Use `npm run migration:create --name=NNN-Name` and write the SQL. The file lands
in `src/shared/database/migrations/`. Check a new migration against
`../docs/DATABASE.md` §5, which also records the ordering constraint that a join table belongs in the migration creating the
*later* of its two parents.

**`synchronize` is off everywhere**, including test. Schema changes go through
reviewed migration files.

**Password hashes** use argon2id and are `select: false` on the entity — a query
that needs one must ask for it explicitly.

**Global guards and interceptors are HTTP-only.** A Nest `APP_GUARD` /
`APP_INTERCEPTOR` runs in *every* context. `ThrottlerGuard` threw
`res.header is not a function` on socket events, and `TransformInterceptor`
wrapped WS acks in the `{ data }` envelope so clients reading `ack.ok` saw
`undefined`. Both now bail out unless `context.getType() === 'http'`.

**Socket auth runs in Socket.IO handshake middleware**, not `handleConnection` —
the latter is async and finishes *after* the client believes it is connected, so
a client emitting immediately can arrive before `socket.data` exists.

**Rooms are the authorization boundary.** Nothing is emitted to a raw socket id.
An admin subscribing to a conversation has it verified against their org first; a
customer socket joins exactly one room, resolved server-side from the session
token, and the client never names a conversation.

**Every message goes through `MessagesService.create`** — one transaction holding
a `pessimistic_write` lock on the conversation row, covering the insert, the
`last_message_at` bump, unread counters, reopen-on-reply, and the optional
`conversationPatch` that makes takeover-on-reply atomic.

**Retrieval is lexical unless configured.** `EMBEDDING_PROVIDER=lexical` hashes
character n-grams — it matches shared character sequences, not meaning. Character
n-grams rather than words because **Thai has no spaces between words**, so a
word-boundary tokenizer fails on the primary language. Everything else in the
pipeline is the production path. See `../docs/ARCHITECTURE.md` TD-28.

**The relevance threshold lives on the provider.** Measured, not guessed: the
lexical provider puts correct matches at 0.44–0.69 and irrelevant ones at 0.88+,
so its default is 0.80; trained encoders cluster tighter and use 0.55. A single
hardcoded number would be wrong for one of them (TD-29).

**`EMBEDDING_DIMENSIONS` is read by migration 008 *and* the boot assertion**, so
the schema and the runtime check cannot drift. Changing it means altering the
column and re-embedding every chunk.

**The AI runs on a stub provider unless configured.** `LLM_PROVIDER=stub` is a
real implementation of `LLMProvider`, not a mock — it lets the queue → worker →
orchestrator → socket path run and be asserted with no key and no spend. Set
`LLM_PROVIDER=anthropic` + `LLM_API_KEY` for real responses; without the key the
provider logs a warning at startup and conversations hand off to a human. **No request from this codebase has
reached the Anthropic API yet** — see `../docs/ARCHITECTURE.md` TD-25.

**A helper called inside `dataSource.transaction` must take the `manager`.**
Using an injected repository there draws a different pooled connection, so the
write blocks on the row lock the transaction holds while the transaction waits
for the write — a self-deadlock that hangs the request and then blocks every
later statement on that table. This actually happened in `AiAgentsService`
(TD-27).

**BullMQ custom job ids cannot contain `:`** — use a hyphen (TD-26). The
enqueue helper swallows errors so a queue outage cannot fail a customer's send,
which means a malformed id silently costs every AI reply and only shows up in
the logs.

**A tool's capability lives in code.** `ai_tools` rows only describe a tool;
the executable body is a class in `modules/tools/registry/` and `ToolService` resolves
calls against an in-memory map built from those classes. Inserting a row cannot
grant a capability (TD-35).

**Zod is the single source of truth for tool input.** The JSON Schema handed to
the model is derived from the same schema that validates what comes back, so the
advertised and enforced contracts cannot drift. `organizationId` always comes
from `ToolContext`, never from model input — that is the defence against a
prompt-injected cross-tenant read (TD-36).

**Tool failures come back as results, not exceptions.** Permission rejections,
validation failures and thrown errors are all fed to the model so it can tell the
customer it could not retrieve the information. Internal error text stays in
`tool_executions` (TD-38).

**Take Over cancels no jobs.** "AI stops immediately" is implemented by the
worker's mode re-check, not by dequeuing — a job already executing cannot be
recalled, and one being dequeued as the cancel arrives slips through. A re-check
immediately before the write cannot be raced (TD-31).

**`notify()` never throws.** A notification is a courtesy on top of an action
that already succeeded; failing to record one must not roll back a handoff or
fail a customer's message.

**The orchestrator re-reads `conversation.mode` before replying.** An admin may
take over between enqueue and execution; checking only at enqueue time leaves a
window where the AI posts after a human owns the thread (R-03).

**Refresh tokens** are stored as sha256 hashes and rotate on every use. Presenting
an already-revoked token revokes the entire token family, because that pattern
means the token was captured and replayed.
