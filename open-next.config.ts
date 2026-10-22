// OpenNext for Cloudflare: default build. The app stays one Next.js app; only the
// runtime changes (Workers instead of Vercel). See docs/MIGRATION_CLOUDFLARE_NEON.md, stage 2.
import { defineCloudflareConfig } from '@opennextjs/cloudflare'

export default defineCloudflareConfig({})
