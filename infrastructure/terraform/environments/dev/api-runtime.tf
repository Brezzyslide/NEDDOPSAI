locals {
  api_container_name = "api"
  api_log_group_name = "/ecs/${local.name_prefix}/api"
  api_source_sha     = replace(var.api_image_tag, "/^sha-([0-9a-f]{40}).*$/", "$1")
}

resource "aws_cloudwatch_log_group" "api" {
  name              = local.api_log_group_name
  retention_in_days = 14

  tags = merge(local.common_tags, {
    Name      = local.api_log_group_name
    Component = "ApiRuntime"
  })
}

resource "aws_ecs_cluster" "api" {
  name = "${local.name_prefix}-api"

  setting {
    name  = "containerInsights"
    value = "disabled"
  }

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-api"
    Component = "ApiRuntime"
  })
}

resource "aws_lb" "api" {
  name               = "${local.name_prefix}-api-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = values(aws_subnet.public)[*].id

  enable_deletion_protection = false
  drop_invalid_header_fields = true

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-api-alb"
    Component = "ApiRuntime"
  })
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name_prefix}-api-tg"
  port        = var.api_container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  deregistration_delay = 30

  health_check {
    enabled             = true
    path                = "/api/healthz"
    protocol            = "HTTP"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-api-tg"
    Component = "ApiRuntime"
  })
}

resource "aws_lb_listener" "api_http_origin" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "fixed-response"

    fixed_response {
      content_type = "text/plain"
      message_body = "Access denied"
      status_code  = "403"
    }
  }

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-api-http-origin"
    Component = "ApiRuntime"
  })
}

resource "aws_lb_listener_rule" "api_from_cloudfront" {
  listener_arn = aws_lb_listener.api_http_origin.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    http_header {
      http_header_name = local.cloudfront_origin_header_name
      values           = [random_password.cloudfront_origin_header.result]
    }
  }

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-api-cloudfront-origin-rule"
    Component = "ApiRuntime"
  })
}

resource "aws_iam_role" "api_execution" {
  name               = "${local.name_prefix}-api-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-api-execution-role"
    Component = "ApiRuntime"
  })
}

resource "aws_iam_role_policy_attachment" "api_execution" {
  role       = aws_iam_role.api_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "api_execution_secrets" {
  statement {
    sid     = "ReadRuntimeSecrets"
    actions = ["secretsmanager:GetSecretValue"]
    resources = [
      aws_db_instance.postgres.master_user_secret[0].secret_arn,
      aws_secretsmanager_secret.app["session"].arn,
      aws_secretsmanager_secret.app["clerk"].arn,
      aws_secretsmanager_secret.app["openai"].arn,
    ]
  }
}

resource "aws_iam_role_policy" "api_execution_secrets" {
  name   = "${local.name_prefix}-api-secret-read"
  role   = aws_iam_role.api_execution.id
  policy = data.aws_iam_policy_document.api_execution_secrets.json
}

resource "aws_iam_role" "api_task" {
  name               = "${local.name_prefix}-api-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-api-task-role"
    Component = "ApiRuntime"
  })
}

data "aws_iam_policy_document" "api_task_storage" {
  statement {
    sid = "ListApplicationStorageBucket"
    actions = [
      "s3:ListBucket",
    ]
    resources = [aws_s3_bucket.app_storage.arn]
  }

  statement {
    sid = "UseApplicationStorageObjects"
    actions = [
      "s3:DeleteObject",
      "s3:GetObject",
      "s3:PutObject",
    ]
    resources = ["${aws_s3_bucket.app_storage.arn}/*"]
  }
}

resource "aws_iam_role_policy" "api_task_storage" {
  name   = "${local.name_prefix}-api-storage-access"
  role   = aws_iam_role.api_task.id
  policy = data.aws_iam_policy_document.api_task_storage.json
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name_prefix}-api"
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
      name      = local.api_container_name
      image     = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = var.api_container_port
          hostPort      = var.api_container_port
          protocol      = "tcp"
        }
      ]

      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "PORT"
          value = tostring(var.api_container_port)
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
          name  = "KNOWLEDGE_WORKER_MODE"
          value = "external"
        },
        {
          name  = "NEEDSOPS_BACKUP_SCHEDULER"
          value = "disabled"
        },
        {
          name  = "NEEDSOPS_RUN_STARTUP_SEEDS"
          value = "false"
        },
        {
          name  = "EMAIL_DELIVERY_MODE"
          value = "development"
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
          value = local.api_source_sha
        },
        {
          name  = "GIT_SHA"
          value = local.api_source_sha
        },
        {
          name  = "BUILD_TIMESTAMP"
          value = var.api_build_timestamp
        },
        {
          name  = "API_VERSION"
          value = var.api_version
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
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "api"
        }
      }
    }
  ])

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-api"
    Component = "ApiRuntime"
  })
}

resource "aws_ecs_service" "api" {
  name            = "${local.name_prefix}-api"
  cluster         = aws_ecs_cluster.api.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  health_check_grace_period_seconds = 120
  enable_execute_command            = false

  network_configuration {
    subnets          = values(aws_subnet.public)[*].id
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = local.api_container_name
    container_port   = var.api_container_port
  }

  depends_on = [
    aws_lb_listener_rule.api_from_cloudfront,
  ]

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-api"
    Component = "ApiRuntime"
  })
}
