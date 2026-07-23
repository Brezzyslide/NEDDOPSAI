# See root Dockerfile — this is the canonical build file.
# Symlinked here for the infrastructure/ directory convention.
# 
# The root Dockerfile is the primary build artifact.
# This file documents how to build each service from the infrastructure directory.
#
# Build API server:
#   docker build --target api -t needsops-api -f ../../Dockerfile ../..
#
# Run API server:
#   docker run -p 5001:5001 --env-file ../../.env needsops-api
