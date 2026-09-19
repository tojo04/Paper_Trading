# Paper Trading Terminal

An educational paper exchange for Indian equities, built to make matching, money movement, and
recovery understandable. Upstox will provide reference market data only. **This application never
places a broker or exchange order.**

> Simulated fills use synthetic liquidity derived from Upstox reference prices; no order is sent to
> an exchange.

Phases 0 through 4 establish the domain contract, durable schema, deterministic C++ matcher, and
the versioned Node-to-C++ IPC boundary. Account and HTTP order workflows are intentionally not
implemented yet.

## Repository map

```text
apps/web/                 React, TypeScript, Vite, Tailwind CSS
apps/api/                 Fastify and PostgreSQL readiness
packages/contracts/       Shared Zod schemas and TypeScript types
services/matching-engine/ C++20 price-time-priority matcher and NDJSON process
tests/e2e/                Reserved for the later Playwright journey
docs/                     Architecture, domain rules, API examples, and ADRs
```

The design and invariants are in [architecture](docs/architecture.md) and
[domain rules](docs/domain-rules.md). The staged implementation plan is in `BUILD_STEPS.md`.

## Prerequisites

- Node.js 22.12 or newer
- Corepack and pnpm 10.17.1
- Docker Desktop with Compose
- CMake 3.25 or newer and a C++20 compiler (Visual Studio Build Tools on Windows)

## Setup

```bash
corepack enable
corepack prepare pnpm@10.17.1 --activate
pnpm install --frozen-lockfile
```

If `corepack enable` cannot create system shims (common in a non-administrator Windows shell), use
`corepack install --global pnpm@10.17.1` and prefix pnpm commands with `corepack`, for example
`corepack pnpm install --frozen-lockfile`.

Copy `.env.example` to `.env`, then replace the development password in both `POSTGRES_PASSWORD`
and `DATABASE_URL` with the same local value. Upstox values are not needed in the current fake-data
phase and should remain empty. PostgreSQL uses host port `5433` by default to avoid collisions with
a separately installed PostgreSQL service; change both `POSTGRES_PORT` and `DATABASE_URL` together
if needed. Never commit `.env`.

Start PostgreSQL and wait for it to become healthy:

```bash
docker compose up -d postgres
docker compose ps
```

Create the schema and load the repeatable paper-account/instrument defaults:

```bash
pnpm db:migrate
pnpm db:seed
```

See [docs/database.md](docs/database.md) for the relational model, seed options, and disposable
integration-test behavior.

Start the API and web app together:

```bash
pnpm dev
```

Open <http://localhost:5173>. The page reads API readiness from
<http://localhost:3000/health/ready>. Liveness is available at `/health/live`; readiness returns
HTTP 503 until PostgreSQL answers `SELECT 1`.

## Matching engine

Configure, compile, and run the matcher tests:

```bash
cmake --preset debug
cmake --build --preset debug
ctest --preset debug --output-on-failure
```

The executable is a long-lived, single-writer process. It reads one versioned JSON command per
stdin line and writes exactly one JSON response per stdout line; diagnostics are written to stderr.
It supports LIMIT and MARKET matching, cancellation, reset/replay, snapshots, and duplicate-command
idempotency. All 64-bit prices, quantities, and sequences cross IPC as decimal strings.

The API client discovers the debug or release executable under `build/`. Set
`MATCHING_ENGINE_EXECUTABLE` to an absolute executable path to override discovery. Run the real
cross-process integration suite with:

```bash
pnpm test:integration -- matcher-ipc
```

The separate sanitizer preset enables AddressSanitizer and UndefinedBehaviorSanitizer with GCC or
Clang (MSVC supports the AddressSanitizer portion):

```bash
cmake --preset sanitizers
cmake --build --preset sanitizers
ctest --preset sanitizers --output-on-failure
```

## Quality gate

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cmake --preset debug
cmake --build --preset debug
ctest --preset debug --output-on-failure
docker compose config
```

## Current limitations

The database schema and matcher boundary exist, but authentication, market-data adapters, HTTP
order orchestration, wallet/portfolio settlement, browser realtime events, and recovery from
PostgreSQL are reserved for later phases. The recovery coordinator currently controls matcher
restart; replaying durable orders will be wired when order persistence is implemented.

# Paper_Trading
