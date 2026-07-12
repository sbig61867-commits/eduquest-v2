import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // No embedding in iframes — blocks clickjacking (incl. exam pages)
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // camera/microphone stay allowed for same origin — live exam
          // proctoring (TensorFlow/MediaPipe + LiveKit) depends on them
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
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
