locals {
  storage_bucket_name = "${local.name_prefix}-app-storage-${data.aws_caller_identity.current.account_id}"

  app_secret_names = toset([
    "session",
    "clerk",
    "openai",
    "email",
    "connector",
  ])
}

resource "aws_db_instance" "postgres" {
  identifier = "${local.name_prefix}-postgres"

  engine         = "postgres"
  engine_version = var.database_engine_version
  instance_class = var.database_instance_class

  db_name  = var.database_name
  username = var.database_master_username

  manage_master_user_password = true

  allocated_storage     = var.database_allocated_storage_gib
  max_allocated_storage = var.database_max_allocated_storage_gib
  storage_type          = "gp3"
  storage_encrypted     = true

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period = var.database_backup_retention_days
  backup_window           = "15:00-16:00"
  maintenance_window      = "sun:16:00-sun:17:00"
  copy_tags_to_snapshot   = true

  deletion_protection = false
  skip_final_snapshot = true
  apply_immediately   = true

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-postgres"
    Component = "Database"
  })
}

resource "aws_s3_bucket" "app_storage" {
  bucket = local.storage_bucket_name

  tags = merge(local.common_tags, {
    Name      = local.storage_bucket_name
    Component = "ApplicationStorage"
  })
}

resource "aws_s3_bucket_public_access_block" "app_storage" {
  bucket = aws_s3_bucket.app_storage.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "app_storage" {
  bucket = aws_s3_bucket.app_storage.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "app_storage" {
  bucket = aws_s3_bucket.app_storage.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "app_storage" {
  bucket = aws_s3_bucket.app_storage.id

  rule {
    id     = "dev-storage-hygiene"
    status = "Enabled"

    filter {
      prefix = ""
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }
  }
}

resource "aws_s3_bucket_policy" "app_storage_tls_only" {
  bucket = aws_s3_bucket.app_storage.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "DenyInsecureTransport"
        Effect    = "Deny"
        Principal = "*"
        Action    = "s3:*"
        Resource = [
          aws_s3_bucket.app_storage.arn,
          "${aws_s3_bucket.app_storage.arn}/*",
        ]
        Condition = {
          Bool = {
            "aws:SecureTransport" = "false"
          }
        }
      }
    ]
  })
}

resource "aws_secretsmanager_secret" "app" {
  for_each = local.app_secret_names

  name                    = "${local.name_prefix}/api/${each.key}"
  description             = "NeedsOps Dev API ${each.key} secret container. Value is supplied manually before ECS deployment."
  recovery_window_in_days = 7

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}/api/${each.key}"
    Component = "ApplicationSecret"
  })
}

resource "aws_ecr_repository" "api" {
  name                 = "${local.name_prefix}/api"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}/api"
    Component = "ContainerRegistry"
  })
}

resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Expire untagged Dev images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = {
          type = "expire"
        }
      },
      {
        rulePriority = 2
        description  = "Keep the most recent 20 tagged Dev API images"
        selection = {
          tagStatus     = "tagged"
          tagPrefixList = ["dev-", "sha-"]
          countType     = "imageCountMoreThan"
          countNumber   = 20
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
