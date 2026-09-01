locals {
  knowledge_worker_container_name = "knowledge-ingestion-worker"
  knowledge_worker_log_group_name = "/ecs/${local.name_prefix}/knowledge-ingestion-worker"
  knowledge_worker_source_sha     = replace(var.api_image_tag, "/^sha-([0-9a-f]{40}).*$/", "$1")
}

resource "aws_cloudwatch_log_group" "knowledge_ingestion_worker" {
  name              = local.knowledge_worker_log_group_name
  retention_in_days = 14

  tags = merge(local.common_tags, {
    Name      = local.knowledge_worker_log_group_name
    Component = "KnowledgeIngestionWorker"
  })
}

resource "aws_ecs_task_definition" "knowledge_ingestion_worker" {
  family                   = "${local.name_prefix}-knowledge-ingestion-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.api_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn
  skip_destroy             = true

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = local.knowledge_worker_container_name
      image     = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
      essential = true
      command   = ["node", "--enable-source-maps", "./dist/workers/knowledgeIngestionWorker.mjs"]

      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "NEEDSOPS_ENV"
          value = var.environment_slug
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
          name  = "APP_STORAGE_BUCKET"
          value = aws_s3_bucket.app_storage.id
        },
        {
          name  = "KNOWLEDGE_STORAGE_PROVIDER"
          value = "s3"
        },
        {
          name  = "KNOWLEDGE_S3_BUCKET"
          value = aws_s3_bucket.app_storage.id
        },
        {
          name  = "KNOWLEDGE_S3_PREFIX"
          value = "knowledge"
        },
        {
          name  = "KNOWLEDGE_QUEUE_PROVIDER"
          value = "database"
        },
        {
          name  = "AI_PROVIDER"
          value = "openai"
        },
        {
          name  = "OPENAI_MODEL"
          value = "gpt-4o-mini"
        },
        {
          name  = "SOURCE_VERSION"
          value = local.knowledge_worker_source_sha
        },
        {
          name  = "GIT_SHA"
          value = local.knowledge_worker_source_sha
        },
        {
          name  = "BUILD_TIMESTAMP"
          value = var.api_build_timestamp
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
          name      = "SESSION_SECRET"
          valueFrom = "${aws_secretsmanager_secret.app["session"].arn}:SESSION_SECRET::"
        },
        {
          name      = "INTERNAL_DIAGNOSTICS_TOKEN"
          valueFrom = "${aws_secretsmanager_secret.app["session"].arn}:INTERNAL_DIAGNOSTICS_TOKEN::"
        },
        {
          name      = "CLERK_PUBLISHABLE_KEY"
          valueFrom = "${aws_secretsmanager_secret.app["clerk"].arn}:CLERK_PUBLISHABLE_KEY::"
        },
        {
          name      = "CLERK_SECRET_KEY"
          valueFrom = "${aws_secretsmanager_secret.app["clerk"].arn}:CLERK_SECRET_KEY::"
        },
        {
          name      = "OPENAI_API_KEY"
          valueFrom = "${aws_secretsmanager_secret.app["openai"].arn}:OPENAI_API_KEY::"
        },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.knowledge_ingestion_worker.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "worker"
        }
      }
    }
  ])

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-knowledge-ingestion-worker"
    Component = "KnowledgeIngestionWorker"
  })
}

resource "aws_ecs_service" "knowledge_ingestion_worker" {
  name            = "${local.name_prefix}-knowledge-ingestion-worker"
  cluster         = aws_ecs_cluster.api.id
  task_definition = aws_ecs_task_definition.knowledge_ingestion_worker.arn
  desired_count   = var.knowledge_worker_desired_count
  launch_type     = "FARGATE"

  enable_execute_command = false

  network_configuration {
    subnets          = values(aws_subnet.public)[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = true
  }

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-knowledge-ingestion-worker"
    Component = "KnowledgeIngestionWorker"
    Enabled   = var.knowledge_worker_desired_count > 0 ? "true" : "false"
  })
}
