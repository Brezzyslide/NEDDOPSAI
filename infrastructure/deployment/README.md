# NeedsOps AI+ Deployment

Infrastructure and deployment configuration.

## Current environment

Development on Replit. Production deployment via Replit Deploy.

## Future infrastructure (Sprint 4+)

The platform is designed to be portable to AWS without rebuilding:

| Service | AWS equivalent |
|---|---|
| API server | ECS Fargate |
| PostgreSQL | Amazon RDS (PostgreSQL) |
| Object storage | Amazon S3 |
| Background queue | Amazon SQS |
| Secrets | AWS Secrets Manager |
| Cache | Amazon ElastiCache (Redis) |
| CDN | Amazon CloudFront |

## Environment variables

See `../../.env.example` for all required environment variables.

## Database migrations

```bash
# Push schema to dev
pnpm --filter @workspace/db run push

# Sprint 2+: generate migration files for production
pnpm --filter @workspace/db run generate
```

## Docker

```bash
# Build and run all services
docker compose -f ../docker/docker-compose.yml up

# Build API server only
docker build --target api -t needsops-api ../..
```
