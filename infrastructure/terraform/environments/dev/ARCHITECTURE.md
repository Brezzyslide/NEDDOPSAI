# NeedsOps Dev Network Architecture Decision

## Recommendation

Use the cost-conscious Dev model:

- Sydney VPC across 2 availability zones.
- Public subnets host the future public ALB and initial Dev ECS/Fargate API tasks with public IPs.
- API task security group accepts inbound application traffic only from the ALB security group.
- RDS remains in private database subnets with no public accessibility.
- RDS security group accepts PostgreSQL only from the API task security group.
- Private application subnets remain in the VPC for staging/production migration and future private ECS placement.
- No NAT Gateway.
- S3 Gateway endpoint retained.
- Paid interface endpoints disabled by default.
- ECR, CloudWatch Logs, Secrets Manager, Clerk, OpenAI and Resend access can use controlled outbound HTTPS from Dev ECS tasks.

This keeps networking from consuming a large share of the USD `$300/month` Dev budget before RDS, ALB or ECS exist.

## Option comparison

| Option | Security implications | Approx fixed monthly networking cost | Operational complexity | Migration path |
|---|---|---:|---|---|
| Private app subnets + interface endpoints | Strong private-placement posture; AWS service traffic stays inside VPC endpoints; no broad internet egress from tasks. | USD `$100-$130` for 7 interface endpoints across 2 AZs before workloads. | Medium-high: endpoint selection, endpoint policies, private DNS, security-group management. | Good for staging/production, but expensive for early Dev. |
| Public Dev ECS + private RDS + no NAT + S3 Gateway | ECS tasks can receive public IPs, but inbound remains ALB-only by security group; RDS stays private and accepts only ECS SG. Outbound HTTPS is available for AWS APIs and external providers. | USD `$0` fixed networking cost before traffic. | Low: simpler Dev bootstrap, fewer moving parts, easier debugging. | Move ECS service to private app subnets later by adding NAT or selected interface endpoints; DB design already production-shaped. |
| Private Dev ECS + NAT Gateway | Tasks are private; outbound internet flows through NAT; RDS remains private. | Roughly USD `$45-$70` for one NAT Gateway before data processing; more for multi-AZ NAT. | Medium: NAT routing and resilience trade-off; single NAT is cheaper but less AZ-resilient. | Common staging path; production can use NAT per AZ plus selected endpoints. |

## Decision rationale

The public Dev ECS model is the best current trade-off. It preserves the important boundary, private RDS, while avoiding idle network spend before the application workload exists. It also avoids premature endpoint sprawl. The risk of public task IPs is controlled by keeping application inbound restricted to the ALB security group and using no direct public ingress rule on the ECS security group.

## Future staging/production path

When moving beyond Dev:

1. Keep RDS in private DB subnets.
2. Move ECS tasks from public subnets to private app subnets.
3. Add NAT Gateway or a deliberate endpoint set after measuring required outbound dependencies.
4. Tighten ALB ingress CIDRs and WAF posture as the public web/API surface matures.
5. Add interface endpoint policies where private AWS API access is required.

## Phase 3B data/runtime foundation

The planned data foundation adds the minimum resources needed before API
deployment:

- A private, encrypted, single-AZ RDS PostgreSQL instance in the existing DB
  subnet group.
- RDS-managed master password generation in Secrets Manager.
- One private application S3 bucket for logical prefixes such as uploads,
  generated artifacts, connector-returned files and backups.
- Empty Secrets Manager containers for owner-supplied runtime secrets. Values
  are not stored in Terraform source or state.
- A private ECR repository for the future API container image.

RDS remains private. PostgreSQL is accepted only from the API security group.
No ECS, ALB, CloudFront, DNS, ACM, NAT Gateway or application deployment is part
of this phase.
