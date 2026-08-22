variable "region" {
  type        = string
  description = "AWS region for the Terraform backend resources."
  default     = "ap-southeast-2"
}

variable "state_bucket_name" {
  type        = string
  description = "Globally unique S3 bucket name for NeedsOps Dev Terraform state."
}
