import type { NextConfig } from "next";
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
  // challenges.cloudflare.com: the Turnstile CAPTCHA on the auth forms
  // (src/components/shared/turnstile.tsx), script and its iframe.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://cdn.jsdelivr.net https://storage.googleapis.com https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  // Course video items: a direct https video file the teacher linked (see
  // src/lib/video-embed.ts, which only ever produces https URLs).
  "media-src 'self' blob: data: https:",
  // Only the two video players src/lib/video-embed.ts can produce, plus the
  // Turnstile iframe. Nothing else may be framed (frame-ancestors below is the
  // reverse direction).
  "frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://challenges.cloudflare.com",
  "font-src 'self' data:",
  // Supabase (REST/auth/storage/realtime), the AI providers called from the
  // browser, LiveKit signalling, and Sentry ingest. Anything else is blocked,
  // so an injected script cannot POST stolen data to an attacker's host.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.livekit.cloud wss://*.livekit.cloud https://generativelanguage.googleapis.com https://cdn.jsdelivr.net https://storage.googleapis.com",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join('; ');

const nextConfig: NextConfig = {
  devIndicators: false,

  // Cloudflare (OpenNext): the middleware bundler resolves the ESM and esnext
  // builds of @opentelemetry/api, which Next's file tracing does not copy by
  // itself (it only follows the CJS entry). Without these the Workers build fails.
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/@opentelemetry/api/build/esm/**/*',
      './node_modules/@opentelemetry/api/build/esnext/**/*',
    ],
  },

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

// Error monitoring (Sentry) was removed on 2026-10-22: not needed before launch.
export default withNextIntl(nextConfig)
