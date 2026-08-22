# NeedsOps Dev Foundation Cost

This estimate covers the applied Phase 3A network foundation and planned Phase
3B data/application-runtime foundation in `environments/dev`.

## Resources in this foundation

- 1 VPC
- 2 public subnets
- 2 private application subnets
- 2 private database subnets
- 1 Internet Gateway
- 3 route tables plus associations
- 3 security groups
- 1 DB subnet group
- 1 S3 Gateway VPC endpoint
- 0 Interface VPC endpoints by default
- 1 single-AZ RDS PostgreSQL Dev instance
- 1 private application S3 bucket
- 5 application Secrets Manager containers with no values yet
- 1 private ECR repository

## Deliberately not included

- NAT Gateway
- paid Interface VPC endpoints unless a specific Dev requirement proves one necessary
- ECS/Fargate tasks
- ALB
- CloudFront
- DNS
- GitHub OIDC
- populated application secret values

## Estimated monthly cost

Planning estimate for Sydney (`ap-southeast-2`):

| Item | Monthly estimate |
|---|---:|
| VPC, subnets, route tables, security groups, IGW | USD $0 |
| S3 Gateway VPC endpoint | USD $0 |
| Interface VPC endpoints | USD $0 by default |
| NAT Gateway | USD $0, intentionally omitted |
| RDS PostgreSQL `db.t4g.micro`, single-AZ, 20 GiB gp3 | ~USD $16-$25 |
| RDS backup storage within allocated DB size | usually USD $0 incremental |
| Application S3, low-use Dev | < USD $1 unless data grows |
| Secrets Manager, 5 app containers + RDS managed secret | ~USD $2.40 plus low API-call usage |
| ECR private repository, low-use Dev images | < USD $1-$3 with lifecycle policy |
| ALB | USD $0, not created in this foundation |
| ECS/Fargate | USD $0, not created in this foundation |

Estimated Phase 3B low-use baseline after apply: roughly USD `$20-$35/month`,
dominated by RDS. This remains comfortably below the USD `$300/month` Dev budget
before ECS/ALB/web are introduced.

## Next cost gate

Before ECS/API deployment, produce the next cost gate covering:

- ALB hourly and LCU cost
- ECS task CPU/memory
- optional NAT Gateway if external API calls require private subnet egress

If private ECS tasks require outbound internet access for Clerk, OpenAI or Resend during Dev, the next design choice is:

1. Keep one Dev API task in public subnets with a public IP, restrictive security group and ALB-only inbound while RDS remains private.
2. Add selected paid interface endpoints only if public egress proves unacceptable for a specific AWS API dependency.
3. Add one NAT Gateway in a single public subnet for private ECS egress and accept roughly USD `$45-$70/month` additional fixed baseline before data processing.
