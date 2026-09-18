# ADR 0002: Synthetic liquidity around an external reference price

- Status: Accepted
- Date: 2026-09-18

## Context

Upstox is a market-data provider, not a counterparty for this paper exchange. User orders need
deterministic counterparties for credible local demos and tests, while the UI must not imply that
displayed exchange depth or real execution is available.

## Decision

Node maintains clearly identified system LIMIT orders around the latest fresh external reference
price. Configuration defines spread, number of levels, level spacing, quantity, refresh movement,
and refresh interval. Refresh cancels the old ladder before adding its replacement through the same
serialized matcher path. Synthetic orders are excluded from deterministic matcher unit tests and
marked as system liquidity in durable records and user-visible trades.

## Alternatives

- Matching users only leaves a new installation without useful liquidity.
- Treating provider quotes as directly executable invents depth and execution guarantees.
- A random simulator makes tests and recovery nondeterministic.

## Consequences

Fake and closed-market demos remain useful and reproducible. Prices are plausible projections, not
exchange fills, so the disclosure must remain visible: “Simulated fills use synthetic liquidity
derived from Upstox reference prices; no order is sent to an exchange.” Stale or missing reference
data prevents safe new MARKET orders.

## Migration impact

Synthetic orders need stable system-participant semantics and recovery ordering. Changing the model
or its disclosure requires another ADR and explicit approval.
