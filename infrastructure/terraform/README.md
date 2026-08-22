# NeedsOps Terraform

Reproducible AWS infrastructure for NeedsOps environments.

## Current scope

Phase 3A foundation is intentionally limited to the Dev network/IaC foundation:

- remote state bootstrap strategy
- Sydney VPC
- public ingress/application subnets for the initial cost-conscious Dev ECS placement
- private application subnets
- private database subnets
- route tables
- security groups
- cost-conscious VPC endpoint posture: S3 Gateway by default, paid interface endpoints disabled unless explicitly required
- naming and tags

It does not create RDS, ECS, ECR, ALB, application S3 buckets, application secrets, CloudFront, DNS, GitHub OIDC, or deployed application resources.

## Layout

```text
infrastructure/terraform/
  bootstrap/remote-state/      # One-time backend bucket
  environments/dev/            # NeedsOps Dev foundation
```

## Remote state

Terraform cannot create the backend it is already using. Bootstrap the remote-state resources first, then copy `backend.tf.example` to `backend.tf` in the Dev environment and update the bucket name.

Terraform 1.15 supports S3 native lockfiles through `use_lockfile = true`. DynamoDB-based S3 backend locking is deprecated, so this foundation does not create a DynamoDB lock table.

Recommended sequence:

```bash
cd infrastructure/terraform/bootstrap/remote-state
terraform init
terraform plan -var='state_bucket_name=<unique-state-bucket>'
terraform apply -var='state_bucket_name=<unique-state-bucket>'

cd ../../environments/dev
cp backend.tf.example backend.tf
# Edit backend.tf with the created bucket name.
terraform init
terraform plan
```

Do not commit `backend.tf` if it contains environment-specific backend names.

## Required tags

All resources managed here carry:

- `Project = NeedsOps`
- `Environment = Dev`
- `ManagedBy = InfrastructureAsCode`
