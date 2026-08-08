# Connector Production Gaps — Sprint 29M Audit

_Last updated: 2026-08-08_

This document captures the known gaps between the current desktop-connector
implementation and production-readiness. No sprint-29M change touches the
connector relay services; findings are documented here for the next connector
sprint.

---

## Gap 1 — Legacy long-lived token authentication

`deviceRelayService.ts` issues long-lived activation tokens during device
registration. There is no rotation, expiry, or revocation surface beyond
the manual admin disable/revoke endpoints. A compromised token remains valid
indefinitely until an admin explicitly revokes the device.

**Recommended fix:** Introduce short-lived relay tokens with refresh via the
existing challenge/exchange handshake (`connectorBridgeService.ts`). The
Ed25519 signing infrastructure from Sprint 15 is already available.

---

## Gap 2 — Simulated default mode

When no real connector is attached, `LiveGatewayAdapter` falls back to a
simulated "success" response for any connector action. This is appropriate for
CI/demo but must be gated by an explicit `CONNECTOR_SIMULATION_MODE=true`
environment variable in production, and the flag must be unset by default
in the deployment template.

---

## Gap 3 — LiveGatewayAdapter pending inspection

`LiveGatewayAdapter` has not been load-tested under concurrent specialist
dispatches. The relay WebSocket is a single connection per device; high
message throughput may cause queue back-pressure. Recommend adding a
concurrency limit and back-pressure acknowledgement before production launch.

---

## Gap 4 — No Electron packaging for Linux/Windows

The current Electron build (`artifacts/desktop-connector`) produces a macOS
`.dmg` only. An AppImage target was added in Sprint 34 Cross-Platform, but it
has not been bundled into a signed release pipeline. Linux/Windows customers
cannot self-serve installation without manual builds.

---

## Gap 5 — Knowledge provider integration pending

`connectorSessionManagerService.ts` does not yet have a connector channel
for the Knowledge Resolution Service (KRS). When a specialist needs a live
knowledge query from an external system through a connector, the request
currently falls through to the internal library. A `knowledge_query` channel
type needs to be added and registered in the relay protocol.

---

## Services NOT modified in Sprint 29M

The following services are unchanged and must remain untouched until the
dedicated connector hardening sprint:

- `deviceRelayService.ts`
- `connectorBridgeService.ts`
- `connectorSessionManagerService.ts`
