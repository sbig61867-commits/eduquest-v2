import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";
import createNextIntlPlugin from "next-intl/plugin";

// next-intl is used as a message/formatting layer ONLY: no routing, no
// [locale] segment, no /ar|/en URL prefixes and no next-intl middleware. The
// plugin's single job here is to point the server runtime at the request
// config below; locale itself is resolved from the eq_locale cookie.
const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// Content-Security-Policy.
//
// 'unsafe-inline' / 'unsafe-eval' in script-src are required, not sloppiness:
// Next.js App Router streams inline bootstrap scripts, and the proctoring
// stack (TensorFlow.js + MediaPipe WASM) compiles at runtime. A nonce-based
// policy would need every one of those rewritten. The value of this header
// here is connect-src / frame-ancestors / object-src / base-uri, which is
// where data exfiltration and clickjacking actually live.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net https://storage.googleapis.com",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: data:",
  "font-src 'self' data:",
  // Supabase (REST/auth/storage/realtime), the AI providers called from the
  // browser, LiveKit signalling, and Sentry ingest. Anything else is blocked,
  // so an injected script cannot POST stolen data to an attacker's host.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.livekit.cloud wss://*.livekit.cloud https://*.ingest.sentry.io https://*.ingest.de.sentry.io https://generativelanguage.googleapis.com https://cdn.jsdelivr.net https://storage.googleapis.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ');

const nextConfig: NextConfig = {
  devIndicators: false,

  // Do not advertise the framework. Free reconnaissance otherwise.
  poweredByHeader: false,

  // Never ship browser source maps. Next.js already defaults to false, but
  // stating it means a later `productionBrowserSourceMaps: true` (or a Sentry
  // option that implies it) is a visible, deliberate change rather than a
  // silent one — a .map file republishes the entire original TypeScript.
  productionBrowserSourceMaps: false,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // No embedding in iframes — blocks clickjacking (incl. exam pages)
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Content-Security-Policy", value: CSP },
          // HTTPS only, including subdomains. Vercel serves HTTPS already;
          // this stops a downgrade on the first request of a later visit.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          // camera/microphone stay allowed for same origin — live exam
          // proctoring (TensorFlow/MediaPipe + LiveKit) depends on them
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=(), payment=(), interest-cohort=()",
          },
        ],
      },
      {
        // Never let an exam page (questions, answers-in-flight) sit in a
        // shared or browser cache to be re-read after the session ends.
        source: "/(student|teacher|admin|center|super-admin)/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },
};

// Composition order is load-bearing: next-intl is applied to the plain config
// first, and Sentry wraps the result, so withSentryConfig still sees (and
// keeps) every setting it did before — headers, source-map deletion, the lot.
// Inverting this would hand next-intl an already-instrumented config to
// re-wrap. Sentry behaviour is unchanged by this commit.
export default withSentryConfig(withNextIntl(nextConfig), {
  org: "eduquest-20",
  project: "eduquest-v2",
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
  sourcemaps: {
    // Sentry generates source maps to symbolicate stack traces. Without this,
    // a build that emits them into .next/static would serve the original
    // TypeScript to anyone who opens devtools. Delete them after the upload
    // step so they exist only long enough to reach Sentry.
    deleteSourcemapsAfterUpload: true,
  },
});
