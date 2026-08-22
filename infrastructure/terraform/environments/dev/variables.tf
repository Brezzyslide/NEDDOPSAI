variable "aws_region" {
  type        = string
  description = "Primary AWS region for NeedsOps Dev."
  default     = "ap-southeast-2"
}

variable "project_slug" {
  type        = string
  description = "Lowercase project slug used in AWS resource names."
  default     = "needsops"
}

variable "environment_slug" {
  type        = string
  description = "Lowercase environment slug used in AWS resource names."
  default     = "dev"
}

variable "vpc_cidr" {
  type        = string
  description = "CIDR block for the NeedsOps Dev VPC."
  default     = "10.42.0.0/16"
}

variable "az_count" {
  type        = number
  description = "Number of Sydney availability zones to use for Dev."
  default     = 2

  validation {
    condition     = var.az_count >= 2 && var.az_count <= 3
    error_message = "NeedsOps Dev should use 2 or 3 availability zones."
  }
}

variable "allowed_https_cidrs" {
  type        = list(string)
  description = "CIDR blocks allowed to reach future HTTPS ALB ingress."
  default     = ["0.0.0.0/0"]
}

variable "api_container_port" {
  type        = number
  description = "Future NeedsOps API container port."
  default     = 5001
}

variable "database_name" {
  type        = string
  description = "Initial PostgreSQL database name for NeedsOps Dev."
  default     = "needsops_dev"

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,62}$", var.database_name))
    error_message = "database_name must be a valid PostgreSQL identifier up to 63 characters."
  }
}

variable "database_master_username" {
  type        = string
  description = "RDS master username. Password is generated and managed by RDS in Secrets Manager."
  default     = "needsops_admin"

  validation {
    condition     = can(regex("^[a-zA-Z][a-zA-Z0-9_]{0,62}$", var.database_master_username))
    error_message = "database_master_username must be a valid PostgreSQL identifier up to 63 characters."
  }
}

variable "database_instance_class" {
  type        = string
  description = "Cost-conscious Dev RDS instance class."
  default     = "db.t4g.micro"
}

variable "database_engine_version" {
  type        = string
  description = "RDS PostgreSQL engine version."
  default     = "18.3"
}

variable "database_allocated_storage_gib" {
  type        = number
  description = "Initial RDS allocated storage in GiB."
  default     = 20
}

variable "database_max_allocated_storage_gib" {
  type        = number
  description = "RDS storage autoscaling ceiling in GiB."
  default     = 100
}

variable "database_backup_retention_days" {
  type        = number
  description = "Automated backup retention for Dev RDS."
  default     = 7
}

variable "interface_endpoint_services" {
  type        = list(string)
  description = "Optional paid interface endpoints. Dev defaults to public ECS HTTPS egress and S3 Gateway only."
  default     = []
}

variable "additional_tags" {
  type        = map(string)
  description = "Optional extra tags merged with the required NeedsOps tags."
  default     = {}
}

variable "bootstrap_image_tag" {
  type        = string
  description = "Immutable ECR image tag used by the one-off database bootstrap task."

  validation {
    condition     = can(regex("^sha-[0-9a-f]{40}(-[a-z0-9-]+)?$", var.bootstrap_image_tag))
    error_message = "bootstrap_image_tag must use the immutable sha-<40-char-git-sha> format with an optional lowercase suffix for uncommitted bootstrap build revisions."
  }
}

variable "bootstrap_build_timestamp" {
  type        = string
  description = "ISO-8601 timestamp embedded into the one-off database bootstrap task environment."
}

variable "api_image_tag" {
  type        = string
  description = "Immutable ECR image tag used by the permanent Dev API ECS service."

  validation {
    condition     = can(regex("^sha-[0-9a-f]{40}(-[a-z0-9-]+)?$", var.api_image_tag))
    error_message = "api_image_tag must use the immutable sha-<40-char-git-sha> format with an optional lowercase suffix for uncommitted build revisions."
  }
}

variable "api_build_timestamp" {
  type        = string
  description = "ISO-8601 timestamp embedded into the permanent API task environment."
}

variable "api_version" {
  type        = string
  description = "Application version string exposed by the permanent API diagnostics."
  default     = "0.0.0"
}

variable "api_desired_count" {
  type        = number
  description = "Initial permanent Dev API ECS desired count."
  default     = 1

  validation {
    condition     = var.api_desired_count == 1
    error_message = "Phase 3D Dev API starts with desired_count=1 only."
  }
}

variable "api_temporary_http_cidrs" {
  type        = list(string)
  description = "Temporary HTTP health-test CIDRs while DNS/ACM HTTPS is not ready. Keep empty for final HTTPS-only posture."
  default     = []
}
