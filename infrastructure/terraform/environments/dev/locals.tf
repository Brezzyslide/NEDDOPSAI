locals {
  name_prefix = "${var.project_slug}-${var.environment_slug}"

  required_tags = {
    Project     = "NeedsOps"
    Environment = "Dev"
    ManagedBy   = "InfrastructureAsCode"
  }

  common_tags = merge(local.required_tags, var.additional_tags)
}
