# Contract examples

The matcher envelopes below are implemented by the C++ process and validated by shared Zod
contracts in Node. Money is encoded as a decimal string at the Node/C++ JSON boundary so JavaScript
cannot lose 64-bit integer precision.

## Matcher command and response

One compact JSON value is sent per line. Protocol stdout contains responses only; diagnostics go to
stderr.

```json
{
  "protocolVersion": 1,
  "commandId": "52b581d1-3658-4abd-ab29-9da55d3a0068",
  "type": "ADD_ORDER",
  "payload": {
    "orderId": "10000000-0000-4000-8000-000000000101",
    "participantId": "usr-8",
    "instrumentKey": "NSE_EQ|INE002A01018",
    "side": "BUY",
    "orderType": "LIMIT",
    "quantity": "20",
    "limitPricePaise": "10200"
  }
}
```

```json
{
  "protocolVersion": 1,
  "commandId": "52b581d1-3658-4abd-ab29-9da55d3a0068",
  "type": "ADD_ORDER",
  "accepted": true,
  "result": {
    "bookSequence": "904",
    "order": {
      "orderId": "10000000-0000-4000-8000-000000000101",
      "status": "PARTIALLY_FILLED",
      "filledQuantity": "10",
      "remainingQuantity": "10",
      "engineSequence": "902"
    },
    "fills": [
      {
        "tradeId": "engine-trade-904",
        "instrumentKey": "NSE_EQ|INE002A01018",
        "makerOrderId": "10000000-0000-4000-8000-000000000088",
        "takerOrderId": "10000000-0000-4000-8000-000000000101",
        "buyOrderId": "10000000-0000-4000-8000-000000000101",
        "sellOrderId": "10000000-0000-4000-8000-000000000088",
        "quantity": "10",
        "pricePaise": "10100",
        "engineSequence": "904"
      }
    ],
    "restingOrderUpdates": [
      {
        "orderId": "10000000-0000-4000-8000-000000000088",
        "status": "FILLED",
        "filledQuantity": "10",
        "remainingQuantity": "0",
        "engineSequence": "901"
      }
    ]
  }
}
```

The other command types are `CANCEL_ORDER`, `RESET`, `REPLAY_ORDER`, `SNAPSHOT_BOOK`, and `PING`.
Rejections carry a stable `code` and safe `message`, not an exception or log line.

Representative control commands and responses are:

```json
{"protocolVersion":1,"commandId":"891a9784-a88e-4911-bfde-0394c3250392","type":"CANCEL_ORDER","payload":{"orderId":"10000000-0000-4000-8000-000000000101"}}
{"protocolVersion":1,"commandId":"891a9784-a88e-4911-bfde-0394c3250392","type":"CANCEL_ORDER","accepted":true,"result":{"bookSequence":"905","order":{"orderId":"10000000-0000-4000-8000-000000000101","status":"CANCELLED","filledQuantity":"10","remainingQuantity":"10","engineSequence":"902"}}}
```

```json
{"protocolVersion":1,"commandId":"2c3c4348-59bf-4273-9cc6-c22391da49ac","type":"PING","payload":{}}
{"protocolVersion":1,"commandId":"2c3c4348-59bf-4273-9cc6-c22391da49ac","type":"PING","accepted":true,"result":{"ready":true}}
```

`RESET` clears all in-memory state. `REPLAY_ORDER` inserts a previously accepted active LIMIT order
with its original sequence but never matches. `SNAPSHOT_BOOK` returns visible aggregated levels for
debugging and reconciliation only.

## Browser WebSocket envelope

Every event is versioned and sequenced. Private events are authorized for their user before send.

```json
{
  "version": 1,
  "sequence": "5810",
  "type": "market.tick",
  "occurredAt": "2026-09-18T09:45:12.312Z",
  "payload": {
    "instrumentKey": "NSE_EQ|INE002A01018",
    "ltpPaise": "297450",
    "exchangeTimestampMs": "1789724712000",
    "receivedAtMs": "1789724712312"
  }
}
```

Private events use the same envelope with type `order.updated`, `trade.created`, `wallet.updated`,
or `position.updated`. Market ticks may be coalesced for a slow client. Order and trade events are
never silently dropped; a sequence gap forces HTTP resynchronization.

For example, a committed private order update is:

```json
{
  "version": 1,
  "sequence": "5811",
  "type": "order.updated",
  "occurredAt": "2026-09-18T09:45:12.325Z",
  "payload": {
    "orderId": "ord-101",
    "status": "PARTIALLY_FILLED",
    "quantity": "20",
    "filledQuantity": "10",
    "remainingQuantity": "10"
  }
}
```

## HTTP error envelope

HTTP routes are under `/api/v1`. Errors use a stable domain code and request ID:

```json
{
  "error": {
    "code": "INSUFFICIENT_FUNDS",
    "message": "Available virtual cash is insufficient",
    "requestId": "req-01K5E57Q8FQ4V4P1B4D07Z9X8Q"
  }
}
```
