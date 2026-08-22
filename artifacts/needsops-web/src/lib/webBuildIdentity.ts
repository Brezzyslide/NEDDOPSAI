export const webBuildIdentity = {
  environment:
    import.meta.env.VITE_NEEDSOPS_ENV ?? import.meta.env.MODE ?? 'development',
  gitSha: import.meta.env.VITE_GIT_SHA ?? 'unknown',
  buildTimestamp: import.meta.env.VITE_BUILD_TIMESTAMP ?? 'unknown',
};

declare global {
  interface Window {
    __NEEDSOPS_WEB_BUILD__?: typeof webBuildIdentity;
  }
}
