# AGENTS.md — Paper Trading Terminal

## 1. Mission

Build a fresher-friendly but technically deep paper-trading terminal for Indian equities.

The finished application must demonstrate:

- a React/TypeScript trading UI;
- a Node.js/TypeScript API and WebSocket backend;
- live and historical market data from Upstox V3;
- Protobuf decoding behind an Upstox adapter;
- a C++ price-time-priority matching engine;
- transactional order, wallet, position, and trade persistence in PostgreSQL;
- deterministic recovery and meaningful automated tests.

This is a paper exchange. It must never place a real broker order. Upstox is used only for reference market data.

## 2. Product scope

Implement only:

- account registration, login, refresh, logout;
- a fixed, configurable list of NSE cash instruments;
- watchlist and instrument selection;
- live price display and 1m, 5m, 15m, and 1D candles;
- a virtual INR wallet;
- BUY and SELL;
- MARKET and LIMIT orders;
- price-time priority, partial fills, and cancellation;
- open orders, order history, trade history, positions, average cost, and realized/unrealized P&L;
- real-time market, order, trade, and portfolio updates;
- synthetic liquidity around the live reference price;
- restart recovery of the in-memory order book.

Explicitly out of scope unless the user changes the scope:

- real-money trading or Upstox order placement;
- derivatives, options, leverage, margin, short selling, or fractional shares;
- stop-loss, GTT, AMO, bracket, cover, or iceberg orders;
- advanced chart drawing tools and indicators;
- social features, AI recommendations, news, backtesting, and strategy automation;
- Redis, Kafka, RabbitMQ, Kubernetes, and service decomposition;
- a Node native C++ addon.

## 3. Fixed technology decisions

| Concern | Choice |
|---|---|
| Monorepo | pnpm workspaces |
| Web client | React, TypeScript, Vite, Tailwind CSS |
| Chart | TradingView Lightweight Charts |
| API | Node.js LTS, TypeScript, Fastify |
| Browser realtime | WebSocket |
| Validation/contracts | Zod |
| Database | PostgreSQL with `pg` and SQL migrations |
| Matching engine | C++20, CMake, GoogleTest |
| C++ JSON | nlohmann/json |
| Node–C++ IPC | One long-lived child process using newline-delimited JSON over stdin/stdout |
| Live data | Upstox Market Data Feed V3, WebSocket + Protobuf |
| Historical data | Upstox Historical Candle Data V3 |
| Local runtime | Docker Compose for PostgreSQL; app processes may run locally during development |
| Unit/integration tests | Vitest, GoogleTest, Playwright for a small E2E suite |

Do not replace a fixed choice just because another library is more familiar. Record a proposed change in an ADR and obtain user approval first.

## 4. Repository shape

```text
paper-trading-terminal/
├── AGENTS.md
├── BUILD_STEPS.md
├── README.md
├── package.json
├── pnpm-workspace.yaml
├── docker-compose.yml
├── .env.example
├── docs/
│   ├── architecture.md
│   ├── domain-rules.md
│   ├── api.md
│   └── adr/
├── apps/
│   ├── web/
│   └── api/
├── packages/
│   └── contracts/
├── services/
│   └── matching-engine/
└── tests/
    └── e2e/
```

Keep feature-specific API code together:

```text
apps/api/src/modules/orders/
├── order.routes.ts
├── order.schemas.ts
├── order.service.ts
├── order.repository.ts
└── order.service.test.ts
```

Avoid a generic `utils` dumping ground. Name modules by domain responsibility.

## 5. Authority and component boundaries

### PostgreSQL is the durable source of truth

Persist users, sessions, instruments, watchlists, wallets, wallet ledger entries, orders, trades, and positions in PostgreSQL. Money-changing operations must use database transactions and row locks where required.

### The C++ matcher owns only the live in-memory order book

It accepts validated commands and returns deterministic events. It does not:

- authenticate users;
- connect to PostgreSQL;
- calculate or mutate wallets and positions;
- call Upstox;
- open browser WebSockets;
- make business decisions about account permissions.

### Node orchestrates business operations

Node performs authentication, validation, risk checks, reservation, serialized matcher IPC, database transactions, recovery, and client broadcasts.

### React is not authoritative

Client-side state is a projection of server state. Never calculate authoritative wallet balances, order status, or realized P&L only in the browser.

## 6. Core data flow

### Market data

```text
Upstox authorized WebSocket
  -> binary Protobuf message
  -> Upstox decoder
  -> MarketDataAdapter
  -> internal MarketTick
  -> quote cache in Node memory
  -> browser WebSocket subscribers
```

Upstox types must not leak beyond the adapter. The internal model should be small and stable:

```ts
type MarketTick = {
  instrumentKey: string;
  ltpPaise: bigint;
  exchangeTimestampMs: number;
  receivedAtMs: number;
};
```

### Order placement

```text
HTTP request
  -> authenticate
  -> validate
  -> lock wallet/position rows
  -> reserve cash or quantity
  -> create PENDING order
  -> enqueue one matcher command
  -> C++ returns order/trade events
  -> persist all results in one DB transaction
  -> commit
  -> broadcast committed updates
```

Never broadcast an order or trade before its database transaction commits.

If persistence fails after the C++ process changed its book, stop order intake, restart the matcher, and replay PostgreSQL state before accepting another command.

## 7. Domain invariants

These rules are non-negotiable and require tests.

### Money and quantities

- Store money as signed 64-bit integer paise. Never use floating point for prices, cash, cost basis, fees, or P&L.
- Store share quantities as positive integers.
- Reject zero/negative quantities and invalid tick prices.
- Use UTC timestamps in storage and ISO 8601 at API boundaries. Display India time only in the UI.

### Order rules

- LIMIT orders require `limitPricePaise`; MARKET orders must not contain it.
- BUY orders reserve cash before entering the matcher.
- SELL orders reserve owned, available quantity; short selling is forbidden.
- Resting priority is best price, then the engine-assigned monotonically increasing sequence number.
- The execution price is the resting maker order's price.
- MARKET orders are immediate-or-cancel and never rest in the book.
- A partially filled MARKET order ends terminally as `CANCELLED` with `filledQuantity > 0`.
- LIMIT remainder rests as `OPEN` or `PARTIALLY_FILLED`.
- Cancellation is idempotent. Filled or already-cancelled orders cannot be reopened.
- Enforce `0 <= filledQuantity <= quantity` and `remaining = quantity - filled`.
- Prevent self-trading with a simple cancel-taker policy.
- Every matcher command has a unique `commandId`; duplicate commands return the original result without applying twice.

### Wallet and portfolio rules

- `availableCashPaise + reservedCashPaise` must reconcile to the wallet balance representation.
- Available and reserved values must never be negative.
- Filled BUY value debits cash; better-than-limit execution releases the unused reservation.
- Cancellation releases remaining cash or shares exactly once.
- Positions use weighted-average cost for long holdings.
- A SELL reduces quantity and realizes `(sell price - average cost) * filled quantity`.
- Selling does not change the average cost of remaining shares.
- Unrealized P&L is derived from the latest reference quote and is never persisted as authoritative money.
- Every cash mutation creates an immutable wallet-ledger entry with a reference and idempotency key.

### Trade rules

- For every fill, bought quantity equals sold quantity.
- A trade references both orders and the engine sequence that created it.
- Trade and related order/portfolio/wallet changes commit atomically.

## 8. Matching engine design

Use one order book per instrument:

```cpp
using Price = std::int64_t;
using Quantity = std::int64_t;

std::map<Price, std::deque<Order>, std::greater<Price>> bids;
std::map<Price, std::deque<Order>> asks;
```

Also maintain an `orderId -> locator/metadata` index so cancellation does not scan the entire book. It is acceptable in V1 to use a lazy-cancellation flag/tombstone and remove cancelled entries when they reach the front; document the trade-off.

The engine must be single-writer. Node sends exactly one command at a time and correlates exactly one response by `commandId`. Engine stdout is protocol-only; diagnostics go to stderr.

Supported commands:

- `ADD_ORDER`
- `CANCEL_ORDER`
- `RESET`
- `REPLAY_ORDER`
- `SNAPSHOT_BOOK` for debugging/tests only
- `PING`

Responses contain only facts produced by the engine:

- accepted/rejected;
- resulting order status and remaining quantity;
- fills/trades;
- affected resting-order updates;
- book sequence.

On startup, Node sends `RESET`, then replays non-terminal LIMIT orders in original engine-sequence order. MARKET orders are never replayed.

## 9. Synthetic liquidity

Upstox provides reference data; it does not provide counterparties to this paper exchange.

Implement a clearly labelled `SyntheticLiquidityProvider` in Node:

- consume the latest reference price;
- maintain a small set of system bid/ask LIMIT orders around it;
- use deterministic configuration for spread, levels, and quantities;
- refresh only when the reference price crosses a configured threshold or a configured interval elapses;
- cancel the previous system orders before adding replacements;
- mark generated orders as system liquidity;
- keep this behavior disabled in deterministic matcher unit tests.

The UI and README must state: “Simulated fills use synthetic liquidity derived from Upstox reference prices; no order is sent to an exchange.”

## 10. Suggested database tables

- `users`
- `sessions`
- `instruments`
- `watchlist_items`
- `wallets`
- `wallet_ledger`
- `positions`
- `orders`
- `trades`

Use database constraints as well as application validation. Include unique constraints for external/idempotency identifiers, `CHECK` constraints for quantities and money, and indexes for common order/history queries.

Order status vocabulary:

```text
PENDING, OPEN, PARTIALLY_FILLED, FILLED, CANCELLED, REJECTED
```

Do not persist `UNREALIZED_PNL`; derive it from position cost basis and current quote.

## 11. API and WebSocket conventions

Use `/api/v1` for HTTP routes. Minimum endpoints:

```text
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/instruments
GET    /api/v1/market/candles/:instrumentKey
GET    /api/v1/account/wallet
GET    /api/v1/account/positions
GET    /api/v1/orders
POST   /api/v1/orders
DELETE /api/v1/orders/:orderId
GET    /api/v1/trades
GET    /api/v1/watchlist
PUT    /api/v1/watchlist/:instrumentKey
DELETE /api/v1/watchlist/:instrumentKey
```

Return a consistent error envelope:

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Available virtual cash is insufficient",
    "requestId": "..."
  }
}
```

Browser WebSocket events must be versioned and typed:

```text
market.tick
order.updated
trade.created
wallet.updated
position.updated
```

Authenticate the socket. Authorize private channel events by user ID. Coalesce market ticks if the browser cannot keep up; never silently drop order or trade events.

## 12. Upstox integration rules

- Use the official V3 authorization flow and official Market Data Feed V3 `.proto` schema.
- Handle authorized-URL redirection, binary WebSocket frames, the initial market-status message, initial snapshot, live ticks, reconnect, and re-subscription.
- Use the smallest adequate feed mode. Prefer LTPC for the watchlist unless additional fields are actually displayed.
- Historical candles are fetched server-side and normalized before returning to React.
- Cache recent historical responses briefly in Node memory; do not add Redis.
- Never expose Upstox access tokens to the browser or commit them.
- Put credentials and redirect URI in environment variables documented in `.env.example`.
- Include a deterministic fake market-data adapter so tests and local demos work when the market is closed or credentials are absent.
- Keep fixture payloads small and anonymized; never commit real tokens.

Official references:

- https://upstox.com/developer/api-documentation/v3/get-market-data-feed/
- https://upstox.com/developer/api-documentation/v3/get-historical-candle-data/
- https://tradingview.github.io/lightweight-charts/docs

Verify current official documentation before implementing provider-specific details; do not rely on memory for schemas, limits, or authentication behavior.

## 13. Authentication and security baseline

- Hash passwords using Argon2id.
- Use short-lived access tokens and rotating opaque refresh tokens.
- Store only a hash of each refresh token in PostgreSQL.
- Put the refresh token in an HttpOnly, Secure cookie in production; configure SameSite and CORS deliberately.
- Rate-limit auth and order mutation routes in process.
- Validate every request with Zod and reject unknown enum values.
- Use parameterized SQL only.
- Keep secrets out of logs, errors, fixtures, screenshots, and Git.
- Add secure headers and explicit allowed origins.
- This is a simulation; do not request broker trading permissions.

## 14. Testing requirements

### C++ unit tests

At minimum test:

- best-price priority;
- FIFO at the same price;
- multi-level partial fill;
- non-crossing limit order rests;
- MARKET remainder does not rest;
- cancellation and repeated cancellation;
- self-trade prevention;
- duplicate `commandId` does not double-apply;
- integer prices preserve exact paise;
- reset/replay produces the same visible book;
- quantity conservation across randomized command sequences.

### API tests

Test registration/login, validation, authorization, insufficient funds, insufficient holdings, reservation, better-price release, partial fills, cancellation release, transaction rollback, idempotent request retry, and matcher restart recovery.

### Frontend tests

Test only important behavior: order-ticket validation, rendering of order status/positions, WebSocket event reduction, and reconnect/resync.

### E2E tests

Maintain a small fake-data journey:

1. register and receive virtual cash;
2. select an instrument;
3. place a BUY LIMIT order;
4. receive a fill;
5. observe wallet, trade, and position updates;
6. place and cancel an open order;
7. refresh and verify state persists.

Tests must not depend on the live Upstox API.

## 15. Coding rules

- Use strict TypeScript; do not use `any` to bypass typing.
- Validate at external boundaries and keep domain functions typed and small.
- Prefer explicit domain names over abbreviations.
- Keep route handlers thin; business rules belong in services/domain code.
- Keep SQL in repositories/migrations, not UI or route handlers.
- Do not swallow exceptions. Convert known domain errors at the API boundary.
- Use structured logs with request ID, command ID, and order ID where relevant.
- Do not log passwords, tokens, cookies, or full authorization headers.
- Avoid premature abstractions and generic base classes.
- Do not add a dependency when a short, well-tested local function is clearer.
- Do not reformat or rewrite unrelated files.

## 16. Codex working protocol

For every requested phase:

1. Read this file and the relevant phase in `BUILD_STEPS.md`.
2. Inspect the repository and existing changes before editing.
3. State the small implementation plan and any assumptions.
4. Implement only the requested phase or narrowly necessary prerequisites.
5. Add or update tests with the implementation.
6. Run the narrowest relevant checks first, then the phase quality gate.
7. Fix failures caused by the change; do not hide them by weakening tests.
8. Update documentation and `.env.example` when behavior/configuration changes.
9. Summarize changed files, commands run, results, and remaining limitations.
10. Stop at the phase boundary and wait for review.

Never claim a test passed unless it was run. If a tool or credential is unavailable, report exactly what was not verified and provide the command the user should run.

## 17. Change control

Create a short ADR under `docs/adr/` before changing any of these:

- provider (Upstox);
- Node–C++ transport;
- order priority or execution-price rule;
- PostgreSQL source-of-truth model;
- wallet reservation policy;
- position cost-basis policy;
- synthetic-liquidity model;
- authentication/session approach;
- adding infrastructure such as Redis or a queue.

An ADR must state context, decision, alternatives, consequences, and migration impact.

## 18. Definition of done

A feature is done only when:

- acceptance behavior is implemented;
- errors and edge cases are handled;
- database constraints/migrations exist when needed;
- relevant unit/integration tests pass;
- TypeScript, C++, lint, and formatting checks pass for touched code;
- secrets are not committed;
- API/docs/config examples are current;
- the UI does not imply real trading;
- the feature survives a browser refresh, and durable features survive an API/matcher restart.

