locals {
  cloudfront_origin_id          = "${local.name_prefix}-api-alb"
  cloudfront_origin_header_name = "X-NeedsOps-Origin-Verify"
  cloudfront_api_path_patterns  = ["/api/*", "/v1/*"]
  cloudfront_allowed_methods    = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
  cloudfront_cached_methods     = ["GET", "HEAD", "OPTIONS"]
}

resource "random_password" "cloudfront_origin_header" {
  length           = 48
  special          = false
  override_special = ""
}

resource "aws_cloudfront_distribution" "api_dev" {
  enabled         = true
  is_ipv6_enabled = true
  comment         = "NeedsOps Dev generated HTTPS endpoint for web and API runtime"
  price_class     = "PriceClass_100"
  http_version    = "http2and3"

  origin {
    origin_id                = local.web_cloudfront_origin_id
    domain_name              = aws_s3_bucket.web.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.web.id
  }

  origin {
    origin_id   = local.cloudfront_origin_id
    domain_name = aws_lb.api.dns_name

    custom_header {
      name  = local.cloudfront_origin_header_name
      value = random_password.cloudfront_origin_header.result
    }

    custom_origin_config {
      http_port                = 80
      https_port               = 443
      origin_protocol_policy   = "http-only"
      origin_ssl_protocols     = ["TLSv1.2"]
      origin_keepalive_timeout = 60
      origin_read_timeout      = 60
    }
  }

  default_cache_behavior {
    target_origin_id       = local.web_cloudfront_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = local.web_cloudfront_allowed_get
    cached_methods         = local.web_cloudfront_cached_get
    compress               = true

    cache_policy_id            = data.aws_cloudfront_cache_policy.caching_optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.web_spa_router.arn
    }
  }

  dynamic "ordered_cache_behavior" {
    for_each = toset(local.cloudfront_api_path_patterns)

    content {
      path_pattern           = ordered_cache_behavior.value
      target_origin_id       = local.cloudfront_origin_id
      viewer_protocol_policy = "redirect-to-https"
      allowed_methods        = local.cloudfront_allowed_methods
      cached_methods         = local.cloudfront_cached_methods
      compress               = true

      cache_policy_id            = data.aws_cloudfront_cache_policy.caching_disabled.id
      origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer_except_host.id
      response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security_headers.id
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-api-cloudfront"
    Component = "ApiRuntime"
  })
}
