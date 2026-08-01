# NeedsOps AI+ Desktop — Release Notes

## Version 0.1.1 (Sprint SRM Hardening)

**Release date:** 2026-08-01

### Why this version requires a new installer

Version 0.1.0 installers **cannot** be used for SRM testing or production deployment.
The desktop connector bundle is embedded inside the Electron installer at build time.
Source-level changes to TypeScript do not update already-built installers.

The following changes are compiled into the broker bundle in 0.1.1:

- `GatewayJobRequest` now includes `runtimeInstructions` (the assembled instruction string)
- `OpenClawRpcRequest` (spawn mode) carries `runtimeInstructions` — the ACTIVE instruction field OpenClaw reads
- `BridgeActRequest.task` (bridge-http mode) carries `runtimeInstructions`
- Broker validation rejects old packages lacking `runtimeInstructions` with `UNSUPPORTED_PACKAGE_VERSION`
- Instruction hash integrity check: `instructionHash` must be SHA-256 of `instruction`
- `specialistId` and `manifestHash` cross-checked between manifest and instructions
- Structured audit log for each dispatch (executionId, specialistId, dnaVersion, manifestHash, instructionHash, instructionLength, transport mode)
- `organisation_specialist_configuration` table RLS enforced in broker validation

### New release documentation statement

> "No native dependency change is required solely because of the Specialist Runtime Manifest,
> but the desktop connector and installers **must be rebuilt** because the compiled broker bundle
> contains the new validation and OpenClaw payload logic."
>
> Do not reuse 0.1.0 installers for SRM testing.

### Build requirements

```
# Rebuild desktop connector
pnpm --filter @workspace/desktop-connector build

# Rebuild desktop app and installers
pnpm --filter @workspace/needsops-desktop build
pnpm --filter @workspace/needsops-desktop dist:mac   # macOS arm64 + x64
pnpm --filter @workspace/needsops-desktop dist:win   # Windows x64
```

### Package verification

After build, confirm the bundled broker contains SRM handling:

```bash
grep -l "specialistManifest\|runtimeInstructions\|manifestVersion\|instructionHash\|UNSUPPORTED_PACKAGE_VERSION" \
  artifacts/desktop-connector/dist/*.js
```

All five strings must appear in the bundle.

### No native dependency changes

`keytar` and `electron` version pins are unchanged.
Native rebuild is not required solely for this release.

---

## Version 0.1.0 (Sprint SRM — Specialist Runtime Manifest)

Initial release.
- OpenClaw Runtime Broker embedded in Electron app
- Activation codes and Business Discovery (6 screens)
- WSS relay transport
- Specialist manifest in spawn + bridge payloads
