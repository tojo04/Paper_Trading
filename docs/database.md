# Database model and local operations

PostgreSQL is the durable authority for account and exchange state. The initial migration creates
users, sessions, instruments, watchlists, wallets, immutable wallet ledger entries, positions,
orders, trades, and the singleton paper-account default. Matcher books remain in memory and are
recoverable from active LIMIT orders ordered by `engine_sequence`.

## Numeric rules

Money, quantities, engine sequences, and version counters use PostgreSQL `BIGINT`. The Node driver
returns these values as decimal strings; repositories convert them to `bigint` explicitly. Prices
and cash never pass through JavaScript floating point.

Database checks reject negative cash, invalid position reservations, non-positive order/trade
quantities, invalid statuses, invalid MARKET/LIMIT price combinations, inconsistent filled
quantities, and malformed participant ownership. Public/domain identifiers use UUIDs.

## Migrations

Run migrations from the repository root:

```bash
pnpm db:migrate
```

The runner sorts numbered SQL files, records their SHA-256 checksums in `schema_migrations`, and
uses a PostgreSQL advisory lock so two processes cannot migrate concurrently. An applied migration
must never be edited; add the next numbered file instead.

## Seed configuration

```bash
pnpm db:seed
```

`STARTING_CASH_PAISE` controls the virtual balance assigned by the later registration workflow and
defaults to `100000000` (₹10,00,000). `SEEDED_NSE_SYMBOLS` is a comma-separated subset of:

```text
RELIANCE,TCS,INFY,HDFCBANK,ICICIBANK
```

Seeding is repeatable. Selected instruments are enabled, omitted seed-managed instruments are
disabled rather than deleted, and user-added instruments are untouched.

The instrument keys, ISINs, and tick sizes were checked on 2026-09-18 against the official Upstox
NSE beginning-of-day JSON described in the
[Upstox instruments documentation](https://upstox.com/developer/api-documentation/instruments/).
Upstox recommends `instrument_key` as the stable API identifier; exchange tokens are intentionally
not persisted as identity.

## Integration tests

```bash
pnpm test:integration -- database
```

The suite connects through `TEST_DATABASE_ADMIN_URL` (or `DATABASE_URL` when omitted), creates a
uniquely named disposable database, applies migrations from scratch, exercises constraints and
repositories, then disconnects sessions and drops that database. The configured PostgreSQL role
therefore needs `CREATEDB` in test environments. The normal application role need not have this
permission in production.
