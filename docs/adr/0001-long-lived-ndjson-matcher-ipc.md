# ADR 0001: Long-lived NDJSON matcher IPC

- Status: Accepted
- Date: 2026-09-18

## Context

Node owns transactions and a C++20 component owns the live order books. Their boundary must preserve
64-bit integers, deterministic command ordering, observable failures, and easy process restart
without introducing a network service or native-addon lifecycle risk.

## Decision

Node starts one long-lived matcher child process and communicates using versioned newline-delimited
JSON over stdin/stdout. Node queues exactly one command at a time and correlates one response by
`commandId`. Values that may exceed JavaScript's safe integer range use decimal strings. Matcher
stdout is protocol-only and diagnostics use stderr. Timeouts, EOF, broken pipes, or malformed
responses close order intake and require explicit recovery.

## Alternatives

- A Node native addon avoids serialization but couples memory safety, ABI, build, and process fate.
- TCP/gRPC adds network lifecycle and schemas without benefit for a single-host first release.
- Starting a process per order is simple but loses the live book and is too costly.

## Consequences

The protocol is inspectable and the matcher can be tested independently. A single stream provides a
natural serialization point. JSON parsing and process IPC add overhead, and stdout discipline plus
message-size limits are mandatory.

## Migration impact

Both sides must version protocol changes and share fixtures. A future transport can preserve the
same command/result semantics, but changing transport requires another ADR and explicit approval.
