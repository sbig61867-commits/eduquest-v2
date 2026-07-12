import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  devIndicators: false,
};

export default withSentryConfig(nextConfig, {
  org: "eduquest-20",
  project: "eduquest-v2",
  silent: !process.env.CI,
  // Source-map upload needs SENTRY_AUTH_TOKEN; without it the build still
  // succeeds and events are reported, just with unminified stack traces.
  widenClientFileUpload: true,
  disableLogger: true,
});
