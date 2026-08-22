output "vpc_id" {
  value       = aws_vpc.main.id
  description = "NeedsOps Dev VPC ID."
}

output "public_subnet_ids" {
  value       = values(aws_subnet.public)[*].id
  description = "Public subnet IDs for future ALB ingress."
}

output "private_app_subnet_ids" {
  value       = values(aws_subnet.private_app)[*].id
  description = "Private application subnet IDs for future ECS tasks."
}

output "private_db_subnet_ids" {
  value       = values(aws_subnet.private_db)[*].id
  description = "Private database subnet IDs for future RDS."
}

output "db_subnet_group_name" {
  value       = aws_db_subnet_group.main.name
  description = "DB subnet group name for the future NeedsOps Dev RDS instance."
}

output "security_group_ids" {
  value = {
    alb           = aws_security_group.alb.id
    api           = aws_security_group.api.id
    rds           = aws_security_group.rds.id
    vpc_endpoints = try(aws_security_group.vpc_endpoints[0].id, null)
  }
  description = "Security group IDs reserved for future application layers."
}

output "nat_gateway_created" {
  value       = false
  description = "The initial Dev foundation intentionally avoids NAT Gateway recurring cost."
}

output "interface_endpoint_count" {
  value       = length(aws_vpc_endpoint.interface)
  description = "Paid interface VPC endpoints created by this foundation. Dev default is zero."
}

output "database_identity" {
  value = {
    environment          = var.environment_slug
    region               = var.aws_region
    rds_identifier       = aws_db_instance.postgres.identifier
    db_name              = aws_db_instance.postgres.db_name
    engine               = aws_db_instance.postgres.engine
    engine_version       = aws_db_instance.postgres.engine_version_actual
    publicly_accessible  = aws_db_instance.postgres.publicly_accessible
    db_subnet_group_name = aws_db_instance.postgres.db_subnet_group_name
  }
  description = "Safe database identity fields for future diagnostics. Does not include credentials or connection strings."
}

output "database_master_secret_arn" {
  value       = try(aws_db_instance.postgres.master_user_secret[0].secret_arn, null)
  description = "RDS-managed master credential secret ARN. Sensitive because it identifies a credential container."
  sensitive   = true
}

output "app_storage_bucket_name" {
  value       = aws_s3_bucket.app_storage.id
  description = "Private NeedsOps Dev application storage bucket."
}

output "app_secret_container_names" {
  value       = sort([for secret in aws_secretsmanager_secret.app : secret.name])
  description = "Application secret containers created without secret values."
}

output "api_ecr_repository_url" {
  value       = aws_ecr_repository.api.repository_url
  description = "Private ECR repository URL for the future NeedsOps Dev API image."
}

output "bootstrap_runner" {
  value = {
    ecs_cluster_name    = aws_ecs_cluster.bootstrap.name
    task_definition_arn = aws_ecs_task_definition.db_bootstrap.arn
    container_name      = local.bootstrap_container_name
    log_group_name      = aws_cloudwatch_log_group.db_bootstrap.name
    public_subnet_ids   = values(aws_subnet.public)[*].id
    security_group_id   = aws_security_group.api.id
  }
  description = "One-off ECS/Fargate database bootstrap runner metadata. It is not a permanent API service."
}

output "api_runtime" {
  value = {
    ecs_cluster_name    = aws_ecs_cluster.api.name
    ecs_service_name    = aws_ecs_service.api.name
    task_definition_arn = aws_ecs_task_definition.api.arn
    container_name      = local.api_container_name
    log_group_name      = aws_cloudwatch_log_group.api.name
    load_balancer_dns   = aws_lb.api.dns_name
    cloudfront_domain   = aws_cloudfront_distribution.api_dev.domain_name
    target_group_arn    = aws_lb_target_group.api.arn
    temporary_http      = length(var.api_temporary_http_cidrs) > 0
  }
  description = "Permanent Dev API runtime metadata. Does not include secrets."
}

output "web_runtime" {
  value = {
    web_bucket_name   = aws_s3_bucket.web.id
    cloudfront_domain = aws_cloudfront_distribution.api_dev.domain_name
    default_origin    = local.web_cloudfront_origin_id
    api_path_patterns = local.cloudfront_api_path_patterns
  }
  description = "NeedsOps Dev web hosting metadata. Does not include secrets."
}
