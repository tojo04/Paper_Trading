# Paper Trading Terminal

An educational paper exchange for Indian equities, built to make matching, money movement, and
recovery understandable. Upstox will provide reference market data only. **This application never
places a broker or exchange order.**

> Simulated fills use synthetic liquidity derived from Upstox reference prices; no order is sent to
> an exchange.

Phases 0 and 1 establish the domain contract and a runnable monorepo. Trading workflows are
intentionally not implemented yet.

## Repository map

```text
apps/web/                 React, TypeScript, Vite, Tailwind CSS
apps/api/                 Fastify and PostgreSQL readiness
packages/contracts/       Shared Zod schemas and TypeScript types
services/matching-engine/ C++20 process scaffold and PING harness
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
phase and should remain empty. Never commit `.env`.

Start PostgreSQL and wait for it to become healthy:

```bash
docker compose up -d postgres
docker compose ps
```

Start the API and web app together:

```bash
pnpm dev
```

Open <http://localhost:5173>. The page reads API readiness from
<http://localhost:3000/health/ready>. Liveness is available at `/health/live`; readiness returns
HTTP 503 until PostgreSQL answers `SELECT 1`.

## C++ scaffold

Configure, compile, and run its platform-neutral PING smoke test:

```bash
cmake --preset debug
cmake --build --preset debug
ctest --preset debug --output-on-failure
```

The executable accepts `--ping`, or a line containing `PING` on stdin, and returns `PONG`. This is a
Phase 1 harness, not the matcher protocol introduced in later phases.

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

There is no database schema, authentication, market-data feed, order flow, or matching logic yet.
Those are deliberately reserved for later phases so each authority boundary can be tested before
features depend on it.
# Paper_Trading
