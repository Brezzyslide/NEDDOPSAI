#!/usr/bin/env bash
set -euo pipefail

AWS_PROFILE="${AWS_PROFILE:-needsops-dev}"
AWS_REGION="${AWS_REGION:-ap-southeast-2}"
API_VERSION="${API_VERSION:-0.0.0}"
TAG_SUFFIX="${TAG_SUFFIX:-}"

if [[ "${ALLOW_DIRTY_IMAGE_BUILD:-false}" != "true" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Refusing to build an AWS API image from a dirty Git tree." >&2
    echo "Commit or stash all source changes first, or set ALLOW_DIRTY_IMAGE_BUILD=true for local-only experiments." >&2
    exit 1
  fi
fi

SOURCE_VERSION="$(git rev-parse HEAD)"
BUILD_TIMESTAMP="${BUILD_TIMESTAMP:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
IMAGE_TAG="${IMAGE_TAG:-sha-${SOURCE_VERSION}${TAG_SUFFIX}}"
REPOSITORY_URI="${ECR_REPOSITORY_URI:-$(AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" aws ecr describe-repositories --repository-names needsops-dev/api --query 'repositories[0].repositoryUri' --output text)}"

AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" aws ecr get-login-password \
  | docker login --username AWS --password-stdin "${REPOSITORY_URI%/*}"

docker build \
  --target api \
  --build-arg "SOURCE_VERSION=${SOURCE_VERSION}" \
  --build-arg "BUILD_TIMESTAMP=${BUILD_TIMESTAMP}" \
  --build-arg "API_VERSION=${API_VERSION}" \
  -t "${REPOSITORY_URI}:${IMAGE_TAG}" \
  .

docker push "${REPOSITORY_URI}:${IMAGE_TAG}"

AWS_PROFILE="$AWS_PROFILE" AWS_REGION="$AWS_REGION" aws ecr describe-images \
  --repository-name needsops-dev/api \
  --image-ids "imageTag=${IMAGE_TAG}" \
  --query 'imageDetails[0].{tag:imageTags[0],digest:imageDigest,pushed:imagePushedAt}' \
  --output json
