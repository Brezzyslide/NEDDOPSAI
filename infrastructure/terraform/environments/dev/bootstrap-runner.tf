locals {
  bootstrap_container_name = "db-bootstrap"
  bootstrap_log_group_name = "/ecs/${local.name_prefix}/db-bootstrap"
  bootstrap_source_sha     = replace(var.bootstrap_image_tag, "/^sha-([0-9a-f]{40}).*$/", "$1")
}

resource "aws_cloudwatch_log_group" "db_bootstrap" {
  name              = local.bootstrap_log_group_name
  retention_in_days = 14

  tags = merge(local.common_tags, {
    Name      = local.bootstrap_log_group_name
    Component = "BootstrapRunner"
  })
}

resource "aws_ecs_cluster" "bootstrap" {
  name = "${local.name_prefix}-bootstrap"

  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-bootstrap"
    Component = "BootstrapRunner"
  })
}

data "aws_iam_policy_document" "ecs_task_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "bootstrap_execution" {
  name               = "${local.name_prefix}-bootstrap-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-bootstrap-execution-role"
    Component = "BootstrapRunner"
  })
}

resource "aws_iam_role_policy_attachment" "bootstrap_execution" {
  role       = aws_iam_role.bootstrap_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "bootstrap_execution_secrets" {
  statement {
    sid     = "ReadRdsManagedMasterSecret"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_db_instance.postgres.master_user_secret[0].secret_arn,
      aws_secretsmanager_secret.app["database_roles"].arn,
    ]
  }
}

resource "aws_iam_role_policy" "bootstrap_execution_secrets" {
  name   = "${local.name_prefix}-bootstrap-rds-secret-read"
  role   = aws_iam_role.bootstrap_execution.id
  policy = data.aws_iam_policy_document.bootstrap_execution_secrets.json
}

resource "aws_iam_role" "bootstrap_task" {
  name               = "${local.name_prefix}-bootstrap-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-bootstrap-task-role"
    Component = "BootstrapRunner"
  })
}

resource "aws_ecs_task_definition" "db_bootstrap" {
  family                   = "${local.name_prefix}-db-bootstrap"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.bootstrap_execution.arn
  task_role_arn            = aws_iam_role.bootstrap_task.arn
  skip_destroy             = true

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = local.bootstrap_container_name
      image     = "${aws_ecr_repository.api.repository_url}:${var.bootstrap_image_tag}"
      essential = true
      command   = ["node", "--enable-source-maps", "./dist/scripts/db-bootstrap.mjs"]

      environment = [
        {
          name  = "NEEDSOPS_DB_BOOTSTRAP_ENV"
          value = var.environment_slug
        },
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "AWS_REGION"
          value = var.aws_region
        },
        {
          name  = "AWS_DEFAULT_REGION"
          value = var.aws_region
        },
        {
          name  = "EXPECTED_AWS_REGION"
          value = var.aws_region
        },
        {
          name  = "EXPECTED_DATABASE_NAME"
          value = aws_db_instance.postgres.db_name
        },
        {
          name  = "DB_HOST"
          value = aws_db_instance.postgres.address
        },
        {
          name  = "DB_PORT"
          value = tostring(aws_db_instance.postgres.port)
        },
        {
          name  = "DB_NAME"
          value = aws_db_instance.postgres.db_name
        },
        {
          name  = "SOURCE_VERSION"
          value = local.bootstrap_source_sha
        },
        {
          name  = "GIT_SHA"
          value = local.bootstrap_source_sha
        },
        {
          name  = "BUILD_TIMESTAMP"
          value = var.bootstrap_build_timestamp
        },
      ]

      secrets = [
        {
          name      = "DB_USERNAME"
          valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:username::"
        },
        {
          name      = "DB_PASSWORD"
          valueFrom = "${aws_db_instance.postgres.master_user_secret[0].secret_arn}:password::"
        },
        {
          name      = "NEEDSOPS_PLATFORM_APP_PASSWORD"
          valueFrom = "${aws_secretsmanager_secret.app["database_roles"].arn}:NEEDSOPS_PLATFORM_APP_PASSWORD::"
        },
        {
          name      = "NEEDSOPS_WORKER_APP_PASSWORD"
          valueFrom = "${aws_secretsmanager_secret.app["database_roles"].arn}:NEEDSOPS_WORKER_APP_PASSWORD::"
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.db_bootstrap.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "bootstrap"
        }
      }
    }
  ])

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-db-bootstrap"
    Component = "BootstrapRunner"
  })
}
