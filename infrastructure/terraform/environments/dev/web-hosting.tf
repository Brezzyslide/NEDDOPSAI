locals {
  web_bucket_name            = "${local.name_prefix}-web-${data.aws_caller_identity.current.account_id}"
  web_cloudfront_origin_id   = "${local.name_prefix}-web-s3"
  web_cloudfront_function    = "${local.name_prefix}-spa-router"
  web_cloudfront_allowed_get = ["GET", "HEAD", "OPTIONS"]
  web_cloudfront_cached_get  = ["GET", "HEAD"]
}

resource "aws_s3_bucket" "web" {
  bucket        = local.web_bucket_name
  force_destroy = var.web_bucket_force_destroy

  tags = merge(local.common_tags, {
    Name      = local.web_bucket_name
    Component = "WebHosting"
  })
}

resource "aws_s3_bucket_public_access_block" "web" {
  bucket = aws_s3_bucket.web.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "web" {
  bucket = aws_s3_bucket.web.id

  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "web" {
  bucket = aws_s3_bucket.web.id

  rule {
    id     = "expire-old-web-artifacts"
    status = "Enabled"

    filter {
      prefix = ""
    }

    noncurrent_version_expiration {
      noncurrent_days = 30
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

resource "aws_cloudfront_origin_access_control" "web" {
  name                              = "${local.name_prefix}-web-oac"
  description                       = "CloudFront access to the private NeedsOps Dev web bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_s3_bucket_policy" "web" {
  bucket = aws_s3_bucket.web.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "AllowCloudFrontReadOnly"
        Effect    = "Allow"
        Principal = { Service = "cloudfront.amazonaws.com" }
        Action    = "s3:GetObject"
        Resource  = "${aws_s3_bucket.web.arn}/*"
        Condition = {
          StringEquals = {
            "AWS:SourceArn" = aws_cloudfront_distribution.api_dev.arn
          }
        }
      }
    ]
  })
}

resource "aws_cloudfront_function" "web_spa_router" {
  name    = local.web_cloudfront_function
  runtime = "cloudfront-js-2.0"
  comment = "Rewrite NeedsOps Dev web SPA browser routes to index.html without touching API paths."
  publish = true
  code    = <<-EOT
function handler(event) {
  var request = event.request;
  var uri = request.uri || "/";

  if (uri.indexOf("/api/") === 0 || uri.indexOf("/v1/") === 0) {
    return request;
  }

  if (uri === "/" || uri.indexOf(".") === -1) {
    request.uri = "/index.html";
  }

  return request;
}
EOT
}
