# BUILD_STEPS.md — Paper Trading Terminal

## How to use this plan with Codex

Build one phase at a time. Do not ask Codex to generate the entire application in one prompt.

Recommended prompt pattern:

```text
Read AGENTS.md and BUILD_STEPS.md. Implement Phase N only.
First inspect the current repository, then give a short plan, implement it,
run the phase quality gate, and stop. Do not begin Phase N+1.
```

After each phase:

1. review the changed files and the UI if applicable;
2. run the documented quality gate yourself;
3. ask questions about code you cannot explain;
4. commit a working checkpoint;
5. move to the next phase only when the acceptance checklist passes.

The order below intentionally builds the risky domain logic before the polished UI.

## Final architecture

```text
                         Upstox V3
                 live WS + historical REST
                              |
                              v
                    Node/Fastify backend
                    |        |         |
          PostgreSQL|        |IPC      |WebSocket
                    v        v         v
              durable data  C++      React terminal
                            matcher   + Lightweight Charts
```

Important distinction:

```text
Upstox price = external reference price
C++ order book = this project's simulated exchange
Synthetic liquidity = simulated counterparties around the reference price
```

No application code sends an order to Upstox.

---

## Phase 0 — Freeze the domain before scaffolding

### Goal

Write down the rules that later code must preserve.

### Tasks

- Create `docs/architecture.md` with component boundaries and data flows.
- Create `docs/domain-rules.md` covering:
  - integer paise and integer quantities;
  - order states;
  - MARKET as immediate-or-cancel;
  - LIMIT remainder behavior;
  - maker-price execution;
  - price-time priority;
  - no short selling;
  - cash/share reservation;
  - weighted-average cost;
  - cancellation semantics;
  - cancel-taker self-trade prevention;
  - PostgreSQL recovery authority.
- Create ADR 0001 for long-lived NDJSON stdin/stdout IPC.
- Create ADR 0002 for synthetic liquidity based on an external reference price.
- Define example matcher commands/responses and WebSocket event envelopes.
- Draw the order-state diagram in Mermaid.

### Acceptance checklist

- A MARKET remainder has an unambiguous terminal state.
- A partially filled LIMIT cancellation has an unambiguous final quantity and reservation release.
- Execution price and FIFO tie-breaking are explicit.
- The recovery flow is explicit.
- The docs clearly say that the app never places broker orders.

### Quality gate

Manual documentation review. No production code yet.

---

## Phase 1 — Scaffold the monorepo and developer tooling

### Goal

Create a small repository that can build each component independently.

### Tasks

- Initialize Git and pnpm workspaces.
- Create:
  - `apps/web` using React + TypeScript + Vite;
  - `apps/api` using Fastify + TypeScript;
  - `packages/contracts` for shared Zod schemas and event types;
  - `services/matching-engine` using CMake/C++20;
  - `tests/e2e` for later Playwright tests.
- Add root scripts for `dev`, `build`, `test`, `lint`, `format`, and `typecheck`.
- Add ESLint, Prettier, strict TypeScript, and EditorConfig.
- Add C++ warnings and separate debug/release CMake presets.
- Add Docker Compose with PostgreSQL only.
- Add `.env.example`; ignore `.env`, tokens, build output, and coverage.
- Add simple `/health/live` and `/health/ready` API endpoints.
- Add a placeholder web page that displays API readiness.
- Add CI that installs dependencies, type-checks, builds C++, and runs placeholder tests.

### Acceptance checklist

- A new clone has documented prerequisites and setup commands.
- Web and API start concurrently.
- PostgreSQL becomes healthy through Compose.
- The C++ executable builds and responds to `PING` through a simple local harness.
- No secret exists in tracked files.

### Quality gate

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
cmake --preset debug
cmake --build --preset debug
ctest --preset debug
docker compose config
```

Commit suggestion: `chore: scaffold paper trading terminal monorepo`

---

## Phase 2 — Database schema, migrations, and seed data

### Goal

Create a constrained relational model before route implementation.

### Tasks

- Add SQL migrations for:
  - `users`;
  - `sessions`;
  - `instruments`;
  - `watchlist_items`;
  - `wallets`;
  - `wallet_ledger`;
  - `positions`;
  - `orders`;
  - `trades`.
- Use UUIDs for public/domain IDs and a dedicated monotonic engine sequence for ordering.
- Use `BIGINT` for money in paise and quantities that cross process boundaries.
- Add foreign keys, unique constraints, status checks, quantity checks, and timestamps.
- Index order queries by user/status/created time and book recovery by instrument/status/sequence.
- Seed a small, configurable NSE equity list; store Upstox `instrument_key` as a unique provider identifier.
- Seed a configurable starting paper balance, for example `100000000` paise (₹10,00,000).
- Add a minimal transaction helper and repository boundary using `pg`.
- Add migration and repository integration tests against a disposable database.

### Suggested order fields

```text
id, client_order_id, engine_sequence, user_id, instrument_id,
participant_type, side, order_type, limit_price_paise,
quantity, filled_quantity, status, rejection_code,
created_at, updated_at, cancelled_at
```

### Acceptance checklist

- Invalid money, quantity, and status values fail at the database boundary.
- The same `client_order_id` cannot create two user orders.
- A wallet ledger entry has a unique idempotency key.
- All tables can be rebuilt from migrations alone.
- Seed data is repeatable.

### Quality gate

```bash
docker compose up -d postgres
pnpm db:migrate
pnpm db:seed
pnpm test:integration -- database
```

Commit suggestion: `feat(db): add trading domain schema and migrations`

---

## Phase 3 — Build the C++ matching-engine library first

### Goal

Prove matching correctness without Node, PostgreSQL, HTTP, or live data.

### Tasks

- Model `Order`, `Trade`, `OrderBook`, commands, and events with integer types.
- Implement one book per instrument.
- Implement:
  - LIMIT BUY/SELL;
  - MARKET BUY/SELL;
  - price-time priority;
  - maker-price execution;
  - partial and multi-level fills;
  - resting LIMIT remainders;
  - non-resting MARKET remainders;
  - cancel by order ID;
  - cancel-taker self-trade prevention;
  - duplicate-command result cache;
  - reset and deterministic replay;
  - debug snapshot.
- Keep matching independent of JSON/IPC so it is a normal C++ library with direct unit tests.
- Send all logs through an injected logger or stderr; never stdout.
- Add deterministic and randomized invariant tests.

### Essential examples

1. Asks: 10 @ ₹101, 15 @ ₹102. BUY LIMIT 20 @ ₹102 fills 10 @ ₹101 and 10 @ ₹102.
2. Two asks at ₹101 fill in engine-sequence order.
3. BUY LIMIT ₹100 does not cross best ask ₹101 and rests.
4. BUY MARKET consumes available asks and cancels any remainder.
5. Cancelling a resting order removes its available quantity exactly once.
6. Replaying active orders reconstructs the same visible book.

### Acceptance checklist

- No `double`/`float` appears in order or trade monetary code.
- Matching tests do not start Node or PostgreSQL.
- Every fill conserves quantity.
- A MARKET order never appears in a snapshot after processing.
- Test names explain the business behavior.

### Quality gate

```bash
cmake --preset debug
cmake --build --preset debug
ctest --preset debug --output-on-failure
```

Also run AddressSanitizer/UndefinedBehaviorSanitizer in a separate preset.

Commit suggestion: `feat(matcher): implement price-time-priority order book`

---

## Phase 4 — Add the NDJSON protocol and Node matcher client

### Goal

Connect Node and C++ with a small, testable protocol while keeping domain logic separate.

### Tasks

- Add a thin C++ executable around the engine library.
- Read exactly one JSON command per stdin line and emit exactly one JSON response per stdout line.
- Version the envelope:

```json
{
  "protocolVersion": 1,
  "commandId": "uuid",
  "type": "ADD_ORDER",
  "payload": {}
}
```

- Return structured rejection codes; never use log text as a response contract.
- Reject malformed, oversized, or unsupported messages without crashing.
- Implement a Node `MatchingEngineClient` that:
  - spawns one long-lived child process;
  - queues commands and sends one at a time;
  - correlates responses by `commandId`;
  - enforces a timeout;
  - separates stderr logs;
  - detects exit/broken pipes;
  - exposes a readiness state;
  - restarts only through an explicit recovery coordinator.
- Add contract fixtures shared by Node and C++ tests.
- Add an integration test that starts the real compiled matcher.

### Acceptance checklist

- Protocol stdout contains no non-JSON text.
- A malformed line does not corrupt the next valid request.
- A duplicate command does not apply twice.
- A crashed child causes order intake to become unavailable, not silently fall back.
- Node and C++ agree on 64-bit integer serialization. Use decimal strings in JSON if needed to avoid JavaScript precision loss.

### Quality gate

```bash
pnpm test:integration -- matcher-ipc
ctest --preset debug --output-on-failure
```

Commit suggestion: `feat(ipc): connect API to C++ matcher process`

---

## Phase 5 — Authentication and paper accounts

### Goal

Create secure user sessions and the initial virtual wallet.

### Tasks

- Implement register, login, refresh, and logout.
- Hash passwords using Argon2id.
- Issue short-lived access tokens.
- Generate opaque refresh tokens, store only their hashes, rotate on refresh, and revoke on logout.
- Set the refresh cookie securely according to environment.
- Create the wallet and opening ledger credit in the same registration transaction.
- Add auth middleware and current-user typing.
- Add rate limits for auth endpoints.
- Add a `GET /account/wallet` endpoint.
- Add frontend register/login screens and authenticated routing.

### Acceptance checklist

- Duplicate email registration returns a stable domain error.
- Password and raw refresh token never appear in logs/database.
- Refresh rotation invalidates the old token.
- Registration either creates user + wallet + ledger together or creates none.
- The UI survives access-token expiry through one controlled refresh attempt.

### Quality gate

```bash
pnpm test --filter api -- auth
pnpm typecheck
pnpm lint
```

Commit suggestion: `feat(auth): add secure sessions and paper wallet`

---

## Phase 6 — Market-data adapter with fake mode first

### Goal

Create a provider-independent market-data boundary and ensure the app works without live credentials.

### Tasks

- Define `MarketDataProvider` with live subscription and historical-candle methods.
- Implement `FakeMarketDataProvider` first:
  - deterministic ticks;
  - deterministic candles;
  - controllable clock/sequence for tests.
- Add instrument and watchlist endpoints.
- Add the API-to-browser WebSocket gateway.
- Authenticate sockets and track symbol subscriptions.
- Emit versioned `market.tick` events.
- Store latest quotes in a bounded in-memory map.
- Add reconnect/resync behavior to the browser client.
- Add a basic terminal shell: watchlist, selected instrument, current price, connection state.

### Acceptance checklist

- The complete flow runs with no Upstox credential.
- Two browser clients can subscribe to different instruments.
- Slow clients receive coalesced price ticks rather than unbounded queues.
- Private user data is not broadcast during this phase.
- Socket reconnection restores subscriptions.

### Quality gate

```bash
pnpm test --filter api -- market-data
pnpm test --filter web -- websocket
pnpm typecheck
```

Commit suggestion: `feat(market): add provider abstraction and fake realtime feed`

---

## Phase 7 — Implement the real Upstox V3 adapter

### Goal

Receive real Indian-market reference data without coupling the app to provider payloads.

### Tasks

- Read the current official Upstox V3 docs and record the date/links in `docs/architecture.md`.
- Implement authorization URL/token setup without exposing credentials to React.
- Download/vendor or generate from the official Market Data V3 `.proto` according to its license and docs.
- Connect to the authorized WebSocket endpoint with redirect handling.
- Send binary subscription requests.
- Decode market-status, initial-snapshot, and live-feed messages.
- Normalize decoded provider messages into `MarketTick`.
- Implement heartbeat/staleness detection, exponential backoff with jitter, reauthorization when necessary, and re-subscription.
- Implement historical candle retrieval and normalize to the chart model.
- Expose only 1m, 5m, 15m, and 1D intervals.
- Add bounded in-memory candle caching.
- Add recorded Protobuf fixtures and mocked HTTP tests. Never require live Upstox in CI.
- Add a startup config switch: `MARKET_DATA_PROVIDER=fake|upstox`.

### Acceptance checklist

- Upstox-specific types remain within the adapter directory.
- Access tokens never reach the browser.
- Initial snapshot and later ticks map to the same internal type.
- Invalid/unknown Protobuf fields do not crash the process.
- Provider disconnection marks quotes stale instead of pretending they are live.
- Live smoke test instructions exist but CI remains deterministic.

### Quality gate

```bash
pnpm test --filter api -- upstox
pnpm typecheck
pnpm lint
```

Manual optional smoke test during market hours using a local untracked `.env`.

Commit suggestion: `feat(upstox): add protobuf market-data adapter`

---

## Phase 8 — Historical candlestick chart

### Goal

Render a correct, responsive price chart without turning the project into a charting application.

### Tasks

- Add `GET /market/candles/:instrumentKey` with strict interval/date validation.
- Map server candles to Lightweight Charts format in one client adapter.
- Render candlesticks for 1m, 5m, 15m, and 1D.
- Update only the current intraday candle from live ticks.
- Handle loading, empty, stale, closed-market, and provider-error states.
- Resize the chart with its container and clean up subscriptions on unmount.
- Display provider/reference-data attribution required by current terms.

### Acceptance checklist

- Changing instrument/interval cancels or ignores stale requests.
- Timestamps render correctly in India time without changing stored UTC values.
- Live tick updates do not append duplicate candles.
- Component cleanup prevents duplicate socket listeners.

### Quality gate

```bash
pnpm test --filter web -- chart
pnpm typecheck
pnpm build --filter web
```

Commit suggestion: `feat(web): add historical and live candlestick chart`

---

## Phase 9 — Synthetic liquidity and order-risk reservations

### Goal

Create counterparties for the simulated exchange and reserve user resources safely.

### Tasks

- Implement deterministic synthetic bids/asks around each current reference price.
- Configure spread, number of levels, level distance, quantity, refresh threshold, and refresh interval.
- Represent liquidity orders as system orders with stable participant semantics.
- Cancel/replace an instrument's old liquidity as one serialized engine operation sequence.
- Implement risk checks:
  - instrument enabled;
  - positive quantity and valid tick;
  - reference quote exists and is not stale;
  - BUY has enough available cash;
  - SELL has enough unreserved position quantity;
  - no short selling.
- Reservation rules:
  - LIMIT BUY: reserve `limitPrice * remainingQuantity`;
  - MARKET BUY: reserve reference notional plus a configured safety buffer and cap order quantity;
  - SELL: reserve remaining quantity.
- Put reservation changes in immutable wallet-ledger/position reservation records as designed in Phase 0.
- Test refresh behavior with a fake clock.

### Acceptance checklist

- Market orders have fillable synthetic depth in fake-data demos.
- Synthetic fills are clearly identified and disclosed.
- An order never enters the matcher without a successful reservation.
- Concurrent attempts cannot reserve the same cash or shares twice.
- Stale/missing reference data rejects new MARKET orders safely.

### Quality gate

```bash
pnpm test --filter api -- liquidity risk reservation
pnpm test:integration -- concurrent-reservation
```

Commit suggestion: `feat(exchange): add synthetic liquidity and risk reservations`

---

## Phase 10 — Transactional order placement and cancellation

### Goal

Complete the deepest vertical slice: request -> reservation -> matcher -> durable state -> realtime event.

### Tasks

- Implement `POST /orders` with required `clientOrderId` idempotency key.
- Serialize matcher mutations through one in-process command queue.
- In the placement workflow:
  1. validate and authenticate;
  2. begin a DB transaction;
  3. lock the relevant wallet/position;
  4. perform risk checks and reserve resources;
  5. create a `PENDING` order;
  6. send the matcher command;
  7. persist incoming/resting order updates and every trade;
  8. settle/release reservations and update positions/wallet ledger;
  9. commit;
  10. broadcast committed events.
- Implement `DELETE /orders/:id` with ownership checks and idempotent cancellation.
- If DB persistence fails after matcher mutation, close the intake gate and invoke recovery before the next mutation.
- Return stable domain error codes.
- Add integration tests using the real C++ process and PostgreSQL.

### Acceptance checklist

- Retrying the same `clientOrderId` returns the original outcome without another fill.
- Two simultaneous BUY attempts cannot overspend the wallet.
- Two simultaneous SELL attempts cannot oversell a position.
- A better-price BUY releases excess reservation.
- Partial LIMIT fill keeps only remaining reservation.
- Cancellation releases remaining reservation once.
- No WebSocket event is emitted for a rolled-back transaction.

### Quality gate

```bash
pnpm test:integration -- order-lifecycle
pnpm test:integration -- concurrency
pnpm typecheck
pnpm lint
```

Commit suggestion: `feat(orders): add transactional paper-order lifecycle`

---

## Phase 11 — Portfolio, P&L, and account projections

### Goal

Expose understandable account state derived from committed trades.

### Tasks

- Update positions transactionally on each fill using weighted-average cost.
- Track realized P&L on SELL fills.
- Derive unrealized P&L at read time from the latest non-stale quote.
- Implement wallet, positions, orders, and trades read endpoints with pagination.
- Return available/reserved totals separately.
- Add private socket events:
  - `order.updated`;
  - `trade.created`;
  - `wallet.updated`;
  - `position.updated`.
- Add a resync endpoint or initial private-state snapshot after reconnect.
- Add reconciliation queries/tests comparing trades, positions, and wallet ledger.

### Required calculation tests

```text
BUY 10 @ ₹100
BUY 20 @ ₹130
average cost = ₹120 for 30 shares

SELL 10 @ ₹150
realized P&L = ₹300
remaining quantity = 20
remaining average cost = ₹120
```

### Acceptance checklist

- Realized and unrealized P&L are never mixed.
- A missing/stale quote produces an explicit unavailable unrealized P&L, not zero.
- Wallet ledger and order/trade references reconcile.
- Pagination is stable under new inserts.
- Users cannot read another user's account state.

### Quality gate

```bash
pnpm test --filter api -- portfolio pnl reconciliation
pnpm test:integration -- account-projections
```

Commit suggestion: `feat(portfolio): add positions wallet and pnl projections`

---

## Phase 12 — Complete the trading-terminal UI

### Goal

Build a clean interface around the completed backend without copying a broker pixel-for-pixel.

### Layout

```text
Watchlist | Chart and quote | Buy/Sell ticket
---------------------------------------------
Positions | Open orders | Order history | Trades
```

### Tasks

- Build responsive terminal layout and clear connection/stale-data indicators.
- Add instrument selection and watchlist editing.
- Add BUY/SELL order ticket with MARKET/LIMIT conditional fields.
- Show an explicit confirmation summary before placement.
- Disable duplicate submission while a request is pending; reuse the same `clientOrderId` on safe retry.
- Add wallet available/reserved totals.
- Add positions, open orders, order history, and trades tables.
- Add cancellation with optimistic pending feedback, but reconcile from server result.
- Apply socket events through a single typed reducer/query-cache update path.
- Resync private state after reconnect or detected sequence gap.
- Clearly display “Paper trading / simulated fills / no real order”.
- Ensure keyboard navigation, labels, focus states, contrast, and non-color-only BUY/SELL/status cues.

### Acceptance checklist

- A user can complete the core flow without opening developer tools.
- Refreshing the page preserves durable state.
- Duplicate clicks cannot create duplicate orders.
- Socket reconnect yields the same state as fresh HTTP reads.
- Loading, empty, error, stale, and disconnected states are visible.

### Quality gate

```bash
pnpm test --filter web
pnpm typecheck
pnpm lint
pnpm build --filter web
```

Commit suggestion: `feat(web): complete paper trading terminal workflow`

---

## Phase 13 — Matcher recovery and failure drills

### Goal

Make the in-memory C++ engine safely reconstructible from PostgreSQL.

### Tasks

- Add an order-intake gate with `STARTING`, `READY`, `RECOVERING`, and `UNAVAILABLE` states.
- On API startup or matcher restart:
  1. close intake;
  2. start matcher;
  3. send `RESET`;
  4. load non-terminal LIMIT orders from PostgreSQL in engine-sequence order;
  5. send `REPLAY_ORDER` commands;
  6. compare matcher snapshot totals with DB recovery totals;
  7. restore synthetic liquidity;
  8. open intake.
- Do not generate trades during replay.
- Add reconciliation and mismatch logging.
- Drill crashes at three boundaries:
  - before sending a command;
  - after engine response but before DB commit;
  - after DB commit but before WebSocket broadcast.
- For the last case, ensure reconnect/resync recovers the UI even if an event was missed.

### Acceptance checklist

- The matcher may be killed and restarted without losing open LIMIT orders.
- Replay is deterministic and produces no trade.
- Order intake remains closed on recovery mismatch.
- A DB rollback after engine mutation triggers rebuild before another command.
- Browser resync fixes a missed broadcast.

### Quality gate

```bash
pnpm test:integration -- matcher-recovery
pnpm test:integration -- failure-boundaries
```

Commit suggestion: `feat(recovery): rebuild matcher deterministically from postgres`

---

## Phase 14 — End-to-end tests and operational hardening

### Goal

Verify the complete fake-market flow and make local execution predictable.

### Tasks

- Add the core Playwright journey from `AGENTS.md`.
- Add API request IDs and structured logs.
- Add graceful shutdown: stop intake, finish/abort current command safely, close sockets, stop child matcher, close DB pool.
- Add readiness checks for DB, matcher, and chosen market-data provider.
- Add request/body limits, CORS allowlist, secure headers, and route rate limits.
- Add health and simple metrics counters without introducing a monitoring platform.
- Add dependency/security audit commands; review rather than blindly auto-fixing breaking upgrades.
- Verify Docker and Windows/WSL developer instructions.
- Add database backup/restore commands for local demo data.

### Acceptance checklist

- The E2E suite uses fake data and is repeatable outside market hours.
- SIGTERM produces a clean shutdown.
- Readiness becomes false if DB or matcher is unavailable.
- Application starts from a clean clone using documented steps.
- Logs are sufficient to trace request -> command -> order -> trade without exposing secrets.

### Quality gate

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm build
ctest --preset debug --output-on-failure
```

Commit suggestion: `test: add end-to-end flow and operational hardening`

---

## Phase 15 — Documentation, demo, and resume readiness

### Goal

Make the project easy to run, understand, and defend in an interview.

### Tasks

- Finish README with:
  - concise problem statement;
  - paper-trading disclaimer;
  - architecture diagram;
  - setup for fake and Upstox modes;
  - screenshots/GIF;
  - feature scope and non-goals;
  - matching algorithm explanation and complexity;
  - consistency/recovery explanation;
  - test strategy;
  - known limitations.
- Document all environment variables without real values.
- Document REST and WebSocket contracts.
- Add a 3–5 minute demo script:
  1. live/fake market tick and chart;
  2. limit order rests;
  3. market/crossing order creates a partial or multi-level fill;
  4. portfolio and P&L update;
  5. cancel remaining order;
  6. restart matcher and show recovery.
- Record measured results only after benchmarking; do not invent throughput claims.
- Prepare interview explanations for:
  - why C++;
  - why integer paise;
  - why no Redis;
  - why Protobuf;
  - price-time priority;
  - reservation and transactions;
  - source of truth and recovery;
  - synthetic versus real liquidity.

### Final release gate

- Clean clone setup succeeds.
- All quality-gate commands pass.
- No secret appears in Git history or build artifacts.
- Fake mode demonstrates every core feature.
- Upstox smoke test succeeds when credentials/market conditions allow.
- The README never suggests real exchange execution.
- Every resume claim can be demonstrated or measured.

Commit suggestion: `docs: finalize project guide and demo`

---

## Deliberately deferred ideas

Do not start these until the core release is complete and the user explicitly chooses one:

- replace NDJSON IPC with TCP/gRPC;
- add Redis for multi-instance market fan-out;
- persist event/outbox streams;
- add more order types;
- add options or margin;
- deploy Kubernetes;
- build advanced indicators/backtesting;
- connect real broker order APIs.

The strongest version of this project is the smallest one whose matching, money, recovery, and tests you can explain completely.
