output "state_bucket_name" {
  value       = aws_s3_bucket.state.bucket
  description = "S3 bucket for Terraform remote state."
}

output "s3_locking_enabled" {
  value       = true
  description = "The Dev backend should use Terraform S3 native lockfiles via use_lockfile."
}
