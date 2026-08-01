NeedsOps AI+ — Add Specialist Runtime Manifest

Implement a versioned Specialist Runtime Manifest so the OpenClaw runner receives the same specialist identity, operating principles and skills defined in NeedsOps.

Do not create a separately maintained OpenClaw specialist identity. NeedsOps remains the source of truth.

Current flow:

Chief of Staff
→ TaskPlan
→ ExecutionPackage
→ executionPackageTranslator
→ OpenClawExecutionEngine
→ RuntimeBrokerClient
→ Desktop Connector
→ OpenClaw

Required outcome:

Chief of Staff
→ selected NeedsOps specialist
→ load current Specialist DNA
→ compile Specialist Runtime Manifest
→ include manifest in ExecutionPackage
→ preserve it through translation and broker persistence
→ pass the compiled identity to OpenClaw

The manifest must be generated from the active NeedsOps DNA profile and must not be manually duplicated inside OpenClaw.

Implement sequentially.

1. Inspect the current code

Inspect:

- chiefOfStaffService.ts
- executionService.ts
- ExecutionPackage types
- worker profile and Specialist DNA schemas
- executionPackageTranslator.ts
- openClawExecutionEngine.ts
- RuntimeBrokerClient
- desktop connector broker types
- gatewayAdapter.ts
- OpenClaw spawn-mode payload
- bridge-http payload
- execution session persistence
- existing tests

Do not modify code until the current data flow is confirmed.

2. Add SpecialistRuntimeManifest

Add a shared, versioned type similar to:

{
  specialistId: string;
  workforceRole: string;
  displayName: string;
  dnaProfileId: string;
  dnaVersion: string;
  manifestVersion: 1;

  mission: string;
  responsibilities: string[];
  operatingPrinciples: string[];

  communicationStyle: {
    tone?: string;
    detailLevel?: string;
    language?: string;
  };

  skills: Array<{
    skillId: string;
    name: string;
    version: string;
    instructions?: string;
  }>;

  escalationRules: string[];
  prohibitedBehaviours: string[];

  memoryPolicy: {
    allowedScopes: string[];
    prohibitedScopes: string[];
  };

  generatedAt: string;
}

Adapt field names to the existing NeedsOps schema. Do not create duplicate specialist or DNA tables where current tables already hold the information.

3. Add a compiler service

Create a service such as:

specialistRuntimeManifestService.ts

It must:

- load the active DNA profile for the selected specialist
- verify that the DNA profile is active
- verify the organisation is entitled to the specialist
- compile the DNA into the runtime manifest
- attach DNA and skill version information
- reject missing or invalid DNA
- never include secrets
- never include credentials
- never grant permissions
- never override workerProfile permissions
- produce deterministic output for the same DNA version
- be covered by tests

The manifest defines identity and behaviour.

The existing workerProfile continues to define hard permissions.

4. Extend ExecutionPackage

Add:

specialistManifest: SpecialistRuntimeManifest

The ExecutionPackage must now contain four distinct layers:

- specialistManifest: who the specialist is
- workerProfile: what the specialist is permitted to do
- steps: what the specialist must do now
- requestedTools/connectors: how the work may be carried out

Do not combine permissions into the specialist prompt.

5. Update executionService.ts

When constructing an ExecutionPackage:

- use the Chief of Staff selected primary specialist
- load and compile the active DNA profile
- include specialistManifest
- record the DNA version used
- reject execution if the required active DNA cannot be compiled
- preserve current eligibility and entitlement checks
- preserve tenant isolation
- add an audit event identifying the specialist and DNA version

6. Update OpenClaw translation

Update executionPackageTranslator.ts so specialistManifest is included in the OpenClaw wire payload.

Do not reduce it back to only workforceRole.

The translated payload must contain:

{
  executionId,
  tenantId,
  workforceRole,
  specialistManifest,
  workerProfile,
  steps,
  constraints,
  approvalState,
  requestedTools,
  requestedChannels,
  requestedConnectorCategories,
  callbackUrl,
  expiresAt,
  issuedAt
}

7. Update desktop broker

Update:

- broker wire types
- payload validation
- SQLite persistence
- execution retrieval
- simulated adapter
- live gateway adapter
- spawn mode
- bridge-http mode
- WebSocket task dispatch where relevant

The full manifest must survive unchanged from NeedsOps to the local execution layer.

Do not silently drop unknown fields.

8. Update OpenClaw spawn payload

The spawn-mode request must include a compiled runtime identity, for example:

{
  action: "execute",
  sessionId,
  executionId,
  tenantId,
  workforceRole,
  specialistManifest,
  workerProfile,
  steps,
  constraints
}

OpenClaw must receive both:

- specialistManifest for identity and working behaviour
- workerProfile for hard permissions

Do not treat workforceRole alone as the full persona.

9. Runtime instruction assembly

Add a clear runtime instruction compiler or adapter.

Its output should organise instructions in this order:

1. Specialist identity
2. Mission
3. Responsibilities
4. Operating principles
5. Relevant skills and procedures
6. Communication style
7. Escalation rules
8. Prohibited behaviours
9. Current task steps
10. Current constraints

Hard permissions must still be enforced structurally by the broker and tool layer.

Prompt instructions must not be the sole enforcement mechanism for:

- approved domains
- approved folders
- prohibited actions
- tool availability
- approval gates
- tenant isolation

10. Version and auditability

Persist or record:

- specialist ID
- DNA profile ID
- DNA version
- manifest version
- manifest hash
- generation timestamp
- execution ID

Generate a SHA-256 hash from a canonical serialisation of the manifest.

This allows NeedsOps to prove exactly which specialist instructions were used for an execution.

Do not store unnecessary duplicate sensitive information.

11. Backward compatibility

Existing queued or stored executions may not contain specialistManifest.

Handle them explicitly:

- either reject old packages with a clear unsupported-version error
- or support a temporary compatibility path using workforceRole

Do not silently create an unversioned persona.

New execution packages must require specialistManifest.

Increment the wire protocol or execution package version if the current contract supports versioning.

12. Tests

Add tests for:

- correct DNA profile compilation
- missing DNA rejection
- inactive DNA rejection
- wrong-tenant DNA rejection
- DNA version included
- skill versions included
- deterministic manifest hash
- no secrets included
- manifest survives ExecutionPackage translation
- manifest survives broker persistence
- manifest reaches spawn payload
- manifest reaches bridge-http payload
- workerProfile remains separate
- permissions cannot be enlarged by the manifest
- old package compatibility behaviour
- cross-tenant access rejection

Run all existing tests and do not weaken RLS or authorisation.

13. Deliverables

Report:

- files changed
- files added
- database changes, if any
- updated execution package shape
- example generated manifest
- example OpenClaw spawn payload
- protocol version changes
- test results
- backward compatibility behaviour
- whether desktop installers must be rebuilt

Do not claim OpenClaw uses the manifest until the final spawn or bridge payload demonstrably contains it.

Proceed with implementation now.
