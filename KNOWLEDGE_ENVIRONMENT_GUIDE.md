# Knowledge Environment Guide

## NeedsOps AI+ — Knowledge Pipeline Environment Configuration

This guide documents the environment variables, storage infrastructure, and configuration requirements for the knowledge ingestion, embedding, retrieval, and audit pipeline across all four deployment environments.

---

## Environments

| Environment     | Purpose                                    | Database               | Object Storage   |
|-----------------|--------------------------------------------|------------------------|------------------|
| `development`   | Local developer workstations               | Local Postgres + pgvector | Replit Object Storage (dev bucket) |
| `staging`       | Integration testing, pre-release validation | AWS RDS (Aurora Postgres + pgvector) | AWS S3 (staging bucket) |
| `production`    | Live customer data                         | AWS RDS (Aurora Postgres + pgvector) | AWS S3 (production bucket) |
| `demo`          | Customer demos, sales engineering          | Isolated Postgres instance | AWS S3 (demo bucket) |

---

## Required Environment Variables

### Core AI Provider

| Variable              | Required | Values                           | Description |
|-----------------------|----------|----------------------------------|-------------|
| `OPENAI_API_KEY`      | Yes (prod/staging) | OpenAI API key                  | Used by the AI gateway for LLM responses and embeddings. In Replit development, use the Replit AI Integrations proxy via `AI_PROVIDER=openai`. |
| `AI_PROVIDER`         | No       | `openai` (default), `anthropic`, `gemini` | Which LLM backend the AI gateway uses. Defaults to `openai`. |

### Embedding

| Variable               | Required | Default                          | Description |
|------------------------|----------|----------------------------------|-------------|
| `EMBEDDING_PROVIDER`   | No       | `openai`                         | Embedding provider for knowledge chunk vectorisation. Supported: `openai`. Set to `none` to disable semantic search and use lexical-only retrieval. |
| `EMBEDDING_MODEL`      | No       | `text-embedding-3-small`         | Embedding model name. Must match the model used when existing vectors were created — changing this invalidates all existing embeddings. |

> **Important:** If `EMBEDDING_PROVIDER` is set to `none`, the knowledge retrieval engine falls back to lexical-only search. Semantic search will not function, and retrieval quality will be reduced. This is acceptable for development but must not be used in production with real customer knowledge.

### Object / File Storage

| Variable                          | Required | Default             | Description |
|-----------------------------------|----------|---------------------|-------------|
| `KNOWLEDGE_STORAGE_PROVIDER`      | No       | `replit` (dev), `s3` (prod/staging) | Where uploaded documents are stored. `replit` uses Replit Object Storage (development only). `s3` uses AWS S3. |
| `KNOWLEDGE_STORAGE_BUCKET`        | Yes (S3) | —                   | The S3 bucket name for knowledge document uploads. Each environment has a separate bucket (see bucket names below). |
| `DEFAULT_OBJECT_STORAGE_BUCKET_ID`| Yes (Replit dev) | —             | Replit Object Storage bucket ID for development uploads. Set as a Replit Secret. |
| `PRIVATE_OBJECT_DIR`              | No       | `knowledge/private` | Subdirectory prefix for private/scoped knowledge documents. |
| `PUBLIC_OBJECT_SEARCH_PATHS`      | No       | `knowledge/public`  | Comma-separated prefixes for publicly searchable knowledge objects. |

### DNA & Specialist Configuration

| Variable                    | Required | Default | Description |
|-----------------------------|----------|---------|-------------|
| `ALLOW_STATIC_DNA_FALLBACK` | No       | `true`  | When `true`, specialists without a database-backed DNA profile fall back to the static profile from `lib/workforce-dna`. Set to `false` in production to enforce DB-only profiles. |

### Background Jobs / Queue

| Variable                     | Required | Default | Description |
|------------------------------|----------|---------|-------------|
| `INGESTION_QUEUE_CONCURRENCY`| No       | `2`     | Number of concurrent document ingestion workers. Increase in production for higher throughput. |
| `CURATION_JOB_CONCURRENCY`   | No       | `1`     | Number of concurrent knowledge curation jobs. |
| `QUEUE_POLL_INTERVAL_MS`     | No       | `5000`  | How often the in-process queue worker polls for new jobs (milliseconds). |

### Session and Security

| Variable         | Required | Description |
|------------------|----------|-------------|
| `SESSION_SECRET` | Yes      | Secret key for Express session signing. Set as a Replit Secret in development; use AWS Secrets Manager in staging and production. |

---

## AWS S3 Bucket Naming Convention

Each environment uses a **separate, isolated S3 bucket** to prevent data leakage between environments.

```
needsops-knowledge-dev        ← development (if using S3 in dev)
needsops-knowledge-staging    ← staging
needsops-knowledge-production ← production
needsops-knowledge-demo       ← demo
```

### Bucket Configuration Requirements

All knowledge buckets must be configured with:

- **Block Public Access:** All four options enabled — no public access permitted
- **Server-Side Encryption:** AES-256 (SSE-S3) or AWS KMS
- **Versioning:** Enabled (supports document supersession audit trail)
- **Lifecycle Rules:** Expire incomplete multipart uploads after 7 days
- **Access Logging:** Write access logs to a separate `needsops-access-logs` bucket

### IAM Policy Requirements (API Server Role)

The API server IAM role must have:

```json
{
  "Effect": "Allow",
  "Action": [
    "s3:PutObject",
    "s3:GetObject",
    "s3:DeleteObject",
    "s3:HeadObject"
  ],
  "Resource": "arn:aws:s3:::needsops-knowledge-{environment}/*"
}
```

> **Note on Signed URLs:** The NeedsOps API server does **not** use pre-signed S3 URLs for document uploads. All uploads are proxied through the API (`POST /v1/organisations/:slug/knowledge/sources/:id/upload`) using the server-side `file.save(buffer)` pattern. This is required because Replit sidecar credentials cannot sign S3 URLs. See `artifacts/api-server/src/routes/v1/knowledgeSources.ts` for the upload implementation.

---

## pgvector / RDS Configuration

NeedsOps knowledge retrieval requires the `pgvector` extension for semantic (embedding-based) search.

### AWS RDS Requirements

- **Engine:** PostgreSQL 15 or higher
- **Instance class:** Minimum `db.t3.medium` for staging; `db.r6g.large` or larger for production
- **Storage:** Enable autoscaling (embeddings consume significant storage at scale)
- **Parameter group:** Enable `pgvector` extension:
  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;
  ```

### pgvector Index

The `knowledge_chunks` table uses an IVFFlat index on the embedding column for performance:

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS
  knowledge_chunks_embedding_ivfflat_idx
  ON knowledge_chunks
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
```

> Rebuild this index after bulk ingestion operations that add more than 10,000 chunks. Use `VACUUM ANALYZE knowledge_chunks` after large ingestion runs.

---

## Secrets Manager References (AWS Staging & Production)

In staging and production, secrets are stored in **AWS Secrets Manager** (not environment variables). The API server reads them at startup using the following secret names:

| Secret Name                        | Maps to Env Var       |
|------------------------------------|-----------------------|
| `/needsops/{env}/openai-api-key`   | `OPENAI_API_KEY`      |
| `/needsops/{env}/session-secret`   | `SESSION_SECRET`      |
| `/needsops/{env}/clerk-secret-key` | `CLERK_SECRET_KEY`    |
| `/needsops/{env}/db-url`           | `DATABASE_URL`        |

Where `{env}` is `staging` or `production`.

---

## Data Residency Rules

1. **Participant data stays in-region.** All knowledge documents, embeddings, and audit events for a given organisation must remain in the same AWS region as the organisation's primary RDS instance. Multi-region replication of knowledge data is not permitted without explicit customer consent.

2. **No cross-tenant data access.** Row-Level Security (RLS) is enforced on all knowledge tables (`knowledge_sources`, `knowledge_chunks`, `knowledge_source_scopes`, `retrieval_audit_events`, `specialist_training_status`). The application user must not have the `BYPASSRLS` privilege.

3. **Embeddings are derived data.** Raw document text and its embeddings are stored together in `knowledge_chunks`. Deleting a knowledge source must cascade to delete all chunks and embeddings. The ingestion pipeline enforces this via `ON DELETE CASCADE` on `knowledge_source_id` foreign keys.

4. **Audit retention.** `retrieval_audit_events` records must be retained for a minimum of 12 months. They do not contain document text — only chunk IDs, source IDs, scores, and token counts.

5. **Development isolation.** Development environments must not contain real participant data. All development knowledge uploads should use fictional documents only.

---

## Per-Environment Quick Reference

### Development (Replit)

```bash
# .env (Replit Secrets for sensitive values)
AI_PROVIDER=openai
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
KNOWLEDGE_STORAGE_PROVIDER=replit
DEFAULT_OBJECT_STORAGE_BUCKET_ID=<set as Replit Secret>
PRIVATE_OBJECT_DIR=knowledge/private
PUBLIC_OBJECT_SEARCH_PATHS=knowledge/public
ALLOW_STATIC_DNA_FALLBACK=true
SESSION_SECRET=<set as Replit Secret>
```

### Staging (AWS)

```bash
AI_PROVIDER=openai
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
KNOWLEDGE_STORAGE_PROVIDER=s3
KNOWLEDGE_STORAGE_BUCKET=needsops-knowledge-staging
ALLOW_STATIC_DNA_FALLBACK=false
INGESTION_QUEUE_CONCURRENCY=4
# Secrets from AWS Secrets Manager
```

### Production (AWS)

```bash
AI_PROVIDER=openai
EMBEDDING_PROVIDER=openai
EMBEDDING_MODEL=text-embedding-3-small
KNOWLEDGE_STORAGE_PROVIDER=s3
KNOWLEDGE_STORAGE_BUCKET=needsops-knowledge-production
ALLOW_STATIC_DNA_FALLBACK=false
INGESTION_QUEUE_CONCURRENCY=8
CURATION_JOB_CONCURRENCY=2
# Secrets from AWS Secrets Manager
```

---

## Adding a New Environment Variable

1. Add the variable to this guide with its description, required status, and default.
2. Set the development value as a Replit Secret (never in `.env` files).
3. Add staging and production values to AWS Secrets Manager under `/needsops/{env}/{variable-name}`.
4. Update the API server startup validation (if it is required) so the server fails fast if the variable is missing.
5. Document any migration required if the variable changes the behaviour of existing data (e.g., changing `EMBEDDING_MODEL` invalidates all embeddings).
