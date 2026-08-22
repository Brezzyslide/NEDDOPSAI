export interface RuntimeIdentity {
  environment: string;
  gitSha: string | null;
  buildTimestamp: string | null;
  apiVersion: string;
  awsRegion: string | null;
}

export function getRuntimeIdentity(): RuntimeIdentity {
  return {
    environment: process.env["NEEDSOPS_ENV"] ?? process.env["NODE_ENV"] ?? "unknown",
    gitSha: process.env["SOURCE_VERSION"] ?? process.env["GIT_SHA"] ?? null,
    buildTimestamp: process.env["BUILD_TIMESTAMP"] ?? null,
    apiVersion: process.env["API_VERSION"] ?? "0.0.0",
    awsRegion: process.env["AWS_REGION"] ?? process.env["AWS_DEFAULT_REGION"] ?? null,
  };
}
