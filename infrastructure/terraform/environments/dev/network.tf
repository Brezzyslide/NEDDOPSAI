data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs                        = slice(data.aws_availability_zones.available.names, 0, var.az_count)
  interface_endpoint_enabled = length(var.interface_endpoint_services) > 0
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-vpc"
    Component = "Network"
  })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-igw"
    Component = "Network"
  })
}

resource "aws_subnet" "public" {
  for_each = {
    for idx, az in local.azs : az => idx
  }

  vpc_id                  = aws_vpc.main.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, each.value)
  map_public_ip_on_launch = false

  tags = merge(local.common_tags, {
    Name       = "${local.name_prefix}-public-${each.key}"
    Component  = "Network"
    Tier       = "Public"
    InitialUse = "AlbAndDevEcsTasks"
  })
}

resource "aws_subnet" "private_app" {
  for_each = {
    for idx, az in local.azs : az => idx
  }

  vpc_id                  = aws_vpc.main.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, each.value + 10)
  map_public_ip_on_launch = false

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-private-app-${each.key}"
    Component = "Network"
    Tier      = "PrivateApp"
  })
}

resource "aws_subnet" "private_db" {
  for_each = {
    for idx, az in local.azs : az => idx
  }

  vpc_id                  = aws_vpc.main.id
  availability_zone       = each.key
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, each.value + 20)
  map_public_ip_on_launch = false

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-private-db-${each.key}"
    Component = "Network"
    Tier      = "PrivateDatabase"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-public-rt"
    Component = "Network"
  })
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public

  subnet_id      = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private_app" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-private-app-rt"
    Component = "Network"
  })
}

resource "aws_route_table_association" "private_app" {
  for_each = aws_subnet.private_app

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private_app.id
}

resource "aws_route_table" "private_db" {
  vpc_id = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-private-db-rt"
    Component = "Network"
  })
}

resource "aws_route_table_association" "private_db" {
  for_each = aws_subnet.private_db

  subnet_id      = each.value.id
  route_table_id = aws_route_table.private_db.id
}

resource "aws_security_group" "alb" {
  name        = "${local.name_prefix}-alb-sg"
  description = "Public HTTPS ingress for the future NeedsOps Dev API ALB."
  vpc_id      = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-alb-sg"
    Component = "SecurityGroup"
  })
}

resource "aws_security_group" "api" {
  name        = "${local.name_prefix}-api-sg"
  description = "Future ECS API task security group."
  vpc_id      = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-api-sg"
    Component = "SecurityGroup"
  })
}

resource "aws_security_group" "rds" {
  name        = "${local.name_prefix}-rds-sg"
  description = "Future private RDS PostgreSQL access from API tasks only."
  vpc_id      = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-rds-sg"
    Component = "SecurityGroup"
  })
}

resource "aws_security_group" "vpc_endpoints" {
  count = local.interface_endpoint_enabled ? 1 : 0

  name        = "${local.name_prefix}-vpce-sg"
  description = "Interface endpoint access from private application subnets."
  vpc_id      = aws_vpc.main.id

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-vpce-sg"
    Component = "SecurityGroup"
  })
}

resource "aws_vpc_security_group_ingress_rule" "alb_https" {
  for_each = toset(var.allowed_https_cidrs)

  security_group_id = aws_security_group.alb.id
  description       = "Emergency direct HTTPS from approved client networks"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_ingress_rule" "alb_http_from_cloudfront" {
  security_group_id = aws_security_group.alb.id
  description       = "HTTP origin traffic from CloudFront only"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  prefix_list_id    = data.aws_ec2_managed_prefix_list.cloudfront_origin_facing.id
}

resource "aws_vpc_security_group_ingress_rule" "alb_temporary_http" {
  for_each = toset(var.api_temporary_http_cidrs)

  security_group_id = aws_security_group.alb.id
  description       = "Temporary HTTP from approved Dev health-test client networks"
  ip_protocol       = "tcp"
  from_port         = 80
  to_port           = 80
  cidr_ipv4         = each.value
}

resource "aws_vpc_security_group_egress_rule" "alb_to_api" {
  security_group_id            = aws_security_group.alb.id
  description                  = "ALB to API tasks"
  ip_protocol                  = "tcp"
  from_port                    = var.api_container_port
  to_port                      = var.api_container_port
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "api_from_alb" {
  security_group_id            = aws_security_group.api.id
  description                  = "API traffic from ALB only"
  ip_protocol                  = "tcp"
  from_port                    = var.api_container_port
  to_port                      = var.api_container_port
  referenced_security_group_id = aws_security_group.alb.id
}

resource "aws_vpc_security_group_egress_rule" "api_to_rds" {
  security_group_id            = aws_security_group.api.id
  description                  = "PostgreSQL to RDS only"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.rds.id
}

resource "aws_vpc_security_group_egress_rule" "api_to_vpc_endpoints" {
  count = local.interface_endpoint_enabled ? 1 : 0

  security_group_id            = aws_security_group.api.id
  description                  = "HTTPS to interface VPC endpoints"
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  referenced_security_group_id = aws_security_group.vpc_endpoints[0].id
}

resource "aws_vpc_security_group_egress_rule" "api_to_https_internet" {
  security_group_id = aws_security_group.api.id
  description       = "Controlled HTTPS egress for Dev ECS tasks with public IPs"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "rds_from_api" {
  security_group_id            = aws_security_group.rds.id
  description                  = "PostgreSQL from API tasks"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_vpc_security_group_ingress_rule" "vpc_endpoints_from_api" {
  count = local.interface_endpoint_enabled ? 1 : 0

  security_group_id            = aws_security_group.vpc_endpoints[0].id
  description                  = "HTTPS from API tasks"
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
  referenced_security_group_id = aws_security_group.api.id
}

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnets"
  subnet_ids = values(aws_subnet.private_db)[*].id

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-db-subnets"
    Component = "DatabaseNetwork"
  })
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.aws_region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id, aws_route_table.private_app.id]

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-s3-vpce"
    Component = "VpcEndpoint"
  })
}

resource "aws_vpc_endpoint" "interface" {
  for_each = toset(var.interface_endpoint_services)

  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.${var.aws_region}.${each.value}"
  vpc_endpoint_type   = "Interface"
  private_dns_enabled = true
  subnet_ids          = values(aws_subnet.private_app)[*].id
  security_group_ids  = [aws_security_group.vpc_endpoints[0].id]

  tags = merge(local.common_tags, {
    Name      = "${local.name_prefix}-${replace(each.value, ".", "-")}-vpce"
    Component = "VpcEndpoint"
  })
}
