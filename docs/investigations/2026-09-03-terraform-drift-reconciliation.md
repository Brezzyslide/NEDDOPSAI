# NeedsOps Dev Terraform Drift Reconciliation

Date: 2026-09-03
AWS account: 249994634557
Region: ap-southeast-2
AWS profile: needsops-dev
Repository: `/Users/tayephilipajao/Development/NEDDOPSAI`
Branch: `fix/rls-role-split-proof`

## Executive Summary

Do not apply the current unscoped Terraform plan.

Observed with valid SSO credentials, the current Dev state is not suffering from the earlier "72 resources to add" symptom. Terraform successfully read the remote state and refreshed live AWS resources. The active plan for the previously blocked `sha-b006d182e998ebb9386729743871efa7154cda59` release is:

> `Plan: 5 to add, 1 to change, 2 to destroy.`

The risky part is not the disabled worker itself. The full plan also replaces the API task definition, replaces the bootstrap task definition, and updates the live API ECS service task definition. The live API service is currently running task definition revision `82`, while Terraform state still tracks the API service at revision `58`.

Worker-only creation can be planned in isolation with `-target`, and that targeted plan showed:

> `Plan: 3 to add, 0 to change, 0 to destroy.`

That is a recovery tactic, not the recommended steady-state deployment pattern.

## Evidence Boundary

Commands were read-only:

- `aws sts get-caller-identity`
- `terraform state list`
- `terraform state show`
- `terraform plan`
- `terraform show` for an existing saved plan file
- AWS `describe` and `list` calls

No Terraform apply was run. No AWS resources were created, modified, or deleted. No database records, roles, grants, or secrets were changed.

One full-plan variant with live ECS image variables was attempted after the worker-only plan, but the local command hook blocked it before Terraform started. The completed fresh full plan below used the same `b006d...` release variable set visible in an existing saved plan file and matches the reported blocked-release shape.

## Credential Check

SSO was valid before conclusions were drawn.

Observed:

```text
Account: 249994634557
Arn: arn:aws:sts::249994634557:assumed-role/AWSReservedSSO_AdministratorAccess_699e4b21ffb3647a/taye@mhandrholdings.com.au
```

This rules out the earlier expired-SSO failure mode for this investigation. The earlier 72-add plan can still be treated as non-evidence unless reproduced with valid credentials.

## Current State Location

The active Dev environment has both `backend.tf.example` and a real `backend.tf`.

Observed active backend:

```hcl
terraform {
  backend "s3" {
    bucket       = "needsops-dev-tfstate-ap-southeast-2-24b20592"
    key          = "needsops/dev/foundation.tfstate"
    region       = "ap-southeast-2"
    encrypt      = true
    use_lockfile = true
  }
}
```

The initialized backend cache agrees:

```text
backend.type = s3
bucket       = needsops-dev-tfstate-ap-southeast-2-24b20592
key          = needsops/dev/foundation.tfstate
region       = ap-southeast-2
use_lockfile = true
```

Conclusion: Terraform state lives in S3 at:

```text
s3://needsops-dev-tfstate-ap-southeast-2-24b20592/needsops/dev/foundation.tfstate
```

The `backend.tf.example` is only a template with `REPLACE_WITH_NEEDSOPS_DEV_TERRAFORM_STATE_BUCKET`; it is not what this checkout is currently using.

## Terraform State Inventory

State contains the deployed foundation, web, API runtime, bootstrap runtime, database, S3, CloudFront, ALB, IAM, Secrets Manager secret containers, and networking resources.

Important observed state entries include:

```text
aws_cloudfront_distribution.api_dev
aws_ecs_cluster.api
aws_ecs_cluster.bootstrap
aws_ecs_service.api
aws_ecs_task_definition.api
aws_ecs_task_definition.db_bootstrap
aws_db_instance.postgres
aws_lb.api
aws_lb_listener.api_http_origin
aws_lb_listener_rule.api_from_cloudfront
aws_lb_target_group.api
aws_s3_bucket.app_storage
aws_s3_bucket.web
```

Worker resources are not in state:

```text
aws_cloudwatch_log_group.knowledge_ingestion_worker
aws_ecs_task_definition.knowledge_ingestion_worker
aws_ecs_service.knowledge_ingestion_worker
```

AWS also reports no worker ECS service in the API cluster and no task definition family:

```text
aws ecs list-services --cluster needsops-dev-api
serviceArns:
  arn:aws:ecs:ap-southeast-2:249994634557:service/needsops-dev-api/needsops-dev-api

aws ecs list-task-definitions --family-prefix needsops-dev-knowledge-ingestion-worker
taskDefinitionArns: []
```

## Fresh Full Plan

Command:

```bash
AWS_PROFILE=needsops-dev terraform plan -no-color \
  -var='api_image_tag=sha-b006d182e998ebb9386729743871efa7154cda59' \
  -var='bootstrap_image_tag=sha-b006d182e998ebb9386729743871efa7154cda59' \
  -var='api_build_timestamp=2026-08-26T02:19:09Z' \
  -var='bootstrap_build_timestamp=2026-08-26T02:19:09Z'
```

Summary:

```text
Plan: 5 to add, 1 to change, 2 to destroy.
```

Terraform resource actions:

| Resource | Action | Type | Cause |
| --- | --- | --- | --- |
| `aws_cloudwatch_log_group.knowledge_ingestion_worker` | create | CloudWatch Logs | Configuration added for worker but never applied |
| `aws_ecs_service.knowledge_ingestion_worker` | create | ECS service | Configuration added for disabled worker but never applied |
| `aws_ecs_task_definition.knowledge_ingestion_worker` | create | ECS task definition | Configuration added for worker but never applied |
| `aws_ecs_task_definition.api` | replace | ECS task definition | Release variable/state mismatch; direct ECS deployments moved live service past Terraform state |
| `aws_ecs_task_definition.db_bootstrap` | replace | ECS task definition | Release variable/state mismatch; bootstrap task definition state differs from supplied release variables |
| `aws_ecs_service.api` | update in-place | ECS service | Terraform would point live service at the newly registered API task definition |

There are no S3, CloudFront, ALB, RDS, VPC, IAM role, policy, or secret container changes in the completed full plan.

## Drift Details

### API ECS Service

Terraform state says:

```text
aws_ecs_service.api.task_definition =
arn:aws:ecs:ap-southeast-2:249994634557:task-definition/needsops-dev-api:58
```

AWS live service says:

```text
taskDefinition =
arn:aws:ecs:ap-southeast-2:249994634557:task-definition/needsops-dev-api:82
desiredCount = 1
runningCount = 1
rolloutState = COMPLETED
```

The full plan says:

```text
~ task_definition = "arn:aws:ecs:ap-southeast-2:249994634557:task-definition/needsops-dev-api:82" -> (known after apply)
```

Cause: direct ECS deployment outside Terraform. ECS service events show repeated rolling deployments on 2026-09-01 and 2026-09-02, ending with revision `82` created at `2026-09-02T16:38:07+10:00` and deployed at `2026-09-02T16:38:08+10:00`.

### API Task Definition

State tracks API task definition revision `58`:

```text
arn = arn:aws:ecs:ap-southeast-2:249994634557:task-definition/needsops-dev-api:58
image = .../needsops-dev/api:sha-e54882fdc269a2c7352bddea856a6ce8bd814fa0
BUILD_TIMESTAMP = 2026-08-27T22:09:46Z
GIT_SHA = e54882fdc269a2c7352bddea856a6ce8bd814fa0
SOURCE_VERSION = e54882fdc269a2c7352bddea856a6ce8bd814fa0
API_VERSION = 0.0.0
```

Live service uses API task definition revision `82`:

```text
image = .../needsops-dev/api:sha-e5e294d93f186b9d8ac6a7f1c868cc1300d541d0
BUILD_TIMESTAMP = 2026-09-02T06:38:04Z
GIT_SHA = e5e294d93f186b9d8ac6a7f1c868cc1300d541d0
SOURCE_VERSION = e5e294d93f186b9d8ac6a7f1c868cc1300d541d0
API_VERSION = e5e294d
```

The completed full plan for the blocked `b006d...` release would replace the API task definition from state revision `58` to a newly registered revision using:

```text
image = .../needsops-dev/api:sha-b006d182e998ebb9386729743871efa7154cda59
BUILD_TIMESTAMP = 2026-08-26T02:19:09Z
GIT_SHA = b006d182e998ebb9386729743871efa7154cda59
SOURCE_VERSION = b006d182e998ebb9386729743871efa7154cda59
API_VERSION = 0.0.0
```

Cause: direct ECS deploys plus release variable mismatch. Terraform state is behind the live service. The plan variables also point to an older release than both the state revision and live service revision.

### Bootstrap Task Definition

State tracks bootstrap task definition revision `43`:

```text
arn = arn:aws:ecs:ap-southeast-2:249994634557:task-definition/needsops-dev-db-bootstrap:43
image = .../needsops-dev/api:sha-2659c232d0fd617f35b0a3843552cc4a6e819b33
BUILD_TIMESTAMP = 2026-08-26T08:55:53Z
GIT_SHA = 2659c232d0fd617f35b0a3843552cc4a6e819b33
SOURCE_VERSION = 2659c232d0fd617f35b0a3843552cc4a6e819b33
```

The completed full plan would replace it with:

```text
image = .../needsops-dev/api:sha-b006d182e998ebb9386729743871efa7154cda59
BUILD_TIMESTAMP = 2026-08-26T02:19:09Z
GIT_SHA = b006d182e998ebb9386729743871efa7154cda59
SOURCE_VERSION = b006d182e998ebb9386729743871efa7154cda59
```

Cause: supplied release variables differ from state. This is not evidence of a running-service disruption by itself because no ECS bootstrap service is present in state; it is a task definition replacement only. It still adds noise and risk to a worker-only release.

### Knowledge Ingestion Worker

Configuration exists in `knowledge-worker.tf`:

```text
aws_cloudwatch_log_group.knowledge_ingestion_worker
aws_ecs_task_definition.knowledge_ingestion_worker
aws_ecs_service.knowledge_ingestion_worker
```

The service is configured with:

```text
desired_count = var.knowledge_worker_desired_count
default knowledge_worker_desired_count = 0
cluster = aws_ecs_cluster.api.id
launch_type = FARGATE
assign_public_ip = true
security_groups = [aws_security_group.api.id]
```

Plan output creates the service disabled:

```text
desired_count = 0
Enabled = false
name = needsops-dev-knowledge-ingestion-worker
```

Cause: configuration was added but never applied, so state and AWS both correctly show it absent.

## Worker Isolation

Targeted plan command:

```bash
AWS_PROFILE=needsops-dev terraform plan -no-color \
  -target=aws_cloudwatch_log_group.knowledge_ingestion_worker \
  -target=aws_ecs_task_definition.knowledge_ingestion_worker \
  -target=aws_ecs_service.knowledge_ingestion_worker \
  -var='api_image_tag=sha-b006d182e998ebb9386729743871efa7154cda59' \
  -var='bootstrap_image_tag=sha-2659c232d0fd617f35b0a3843552cc4a6e819b33' \
  -var='api_build_timestamp=2026-08-26T02:19:09Z' \
  -var='bootstrap_build_timestamp=2026-08-26T08:55:53Z'
```

Observed targeted plan:

```text
Plan: 3 to add, 0 to change, 0 to destroy.
```

The worker can be created in isolation by targeting only those three resources, but Terraform itself warns:

```text
The -target option is not for routine use, and is provided only for exceptional situations such as recovering from errors or mistakes
```

Conclusion: yes, it can be isolated as an exceptional recovery step. The safer long-term reconciliation is to remove the API drift first, then apply normal unscoped Terraform plans.

## Running API Risk

Applying the completed unscoped plan would disrupt the running API because it updates the live ECS service from task definition revision `82` to a new Terraform-created revision.

The currently live API task definition is revision `82`, running:

```text
sha-e5e294d93f186b9d8ac6a7f1c868cc1300d541d0
API_VERSION = e5e294d
BUILD_TIMESTAMP = 2026-09-02T06:38:04Z
```

The blocked full plan would create and deploy an older/different API image:

```text
sha-b006d182e998ebb9386729743871efa7154cda59
API_VERSION = 0.0.0
BUILD_TIMESTAMP = 2026-08-26T02:19:09Z
```

Even though ECS would roll the service with desired count `1`, this is a real deployment to the live API. It would start a new task, register it with the target group, drain the existing task, and stop it if healthy. That is a disruption risk and likely a rollback to older application code, not a harmless state cleanup.

## Reconciliation Plan

Recommended path: make Terraform the deployment authority for ECS task definitions and service updates, then add the worker through a normal plan once API drift is reconciled.

1. Freeze direct ECS deployments for Dev until the current state is reconciled.
   Risk: low operational risk; medium team/process friction. Prevents new revision drift while fixing state.

2. Decide the intended live API release SHA and bootstrap SHA.
   Risk: low. Use the currently running API SHA `e5e294d93f186b9d8ac6a7f1c868cc1300d541d0` unless there is a specific rollback decision.

3. Commit or otherwise standardize release variables for Terraform planning.
   Risk: low. The repo currently has only `terraform.tfvars.example`, so repeatable plans depend on operators supplying matching `-var` values.

4. Run an unscoped plan using variables that match the intended live API image/build metadata.
   Risk: low if read-only. Expected result should still include worker creates and may still include an API task definition registration because Terraform tracks task definition revisions as immutable resources.

5. Reconcile ECS task-definition/service ownership.
   Risk: medium. Preferred option is not to import every historical task definition revision. Instead, update the deployment pipeline so Terraform registers task definitions and updates the service. If immediate state alignment is required, use a carefully reviewed state/import procedure for the current task definition/service relationship, but do not use this to normalize continued out-of-band ECS deploys.

6. Apply only when the unscoped plan no longer rolls the API unexpectedly.
   Risk: medium if it still creates a new API revision; low once the plan is worker-only plus expected non-service outputs.

7. Create the worker.
   Risk: low when desired count remains `0`. It creates a log group, task definition, and disabled ECS service. It does not start worker tasks at desired count `0`.

8. After successful normal Terraform operation, enable the worker later by raising `knowledge_worker_desired_count` only after participant scoping and ingestion approval.
   Risk: medium because it starts code that reads from DB/S3/OpenAI secrets and processes queue work.

## Pipeline Recommendation

Deploys should not continue to bypass Terraform for ECS service task definition changes.

Trade-off:

- Direct ECS deploys are faster and convenient for app-only releases.
- Direct ECS deploys make Terraform state stale, so later infrastructure changes are coupled with accidental service rollouts or rollbacks.
- Terraform-controlled deploys are slower and require release variables/artifacts to be explicit, but plans become reviewable and reproducible.

Recommendation: route ECS task definition registration and service updates through Terraform, or split the architecture deliberately so Terraform owns infrastructure and an application deployment tool owns ECS task definitions/services with Terraform ignoring `task_definition` changes. The current mixed model is the worst option because both systems think they can own the same live service.

My preferred model here is Terraform-owned ECS for Dev until the release process is mature, because this environment already embeds application image tags, build timestamps, secrets, ports, public origin, log groups, IAM roles, ALB target groups, and service desired count in Terraform. If the team wants faster app deploys later, make that an explicit design: remove task definition churn from Terraform ownership with lifecycle policy and document the deploy authority.

## Final Answer

Do not apply the current full plan.

The worker itself is safe to create disabled, but the unscoped plan is not worker-only. It would replace the API task definition and update the live `needsops-dev-api` service, currently running revision `82`, to a new task definition built from older `b006d...` variables. That is a live API rollout/rollback risk.

