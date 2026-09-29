// Copies the few @vladmandic/human models live proctoring uses from
// node_modules into public/models/human/, so they are served from our own
// origin (no third-party CDN at exam time, allowed by the CSP's 'self').
// Runs before `dev` and `build`; the copies are git-ignored.
//
// Only what src/hooks/use-face-identity.ts loads, ~8.3 MB in total:
//   blazeface  (0.6 MB)  face box
//   antispoof  (0.8 MB)  photo / screen held up instead of a real face
//   faceres    (6.9 MB)  face descriptor (is it still the same person?)
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const from = join(root, 'node_modules', '@vladmandic', 'human', 'models')
const to = join(root, 'public', 'models', 'human')
export const MODELS = ['blazeface', 'antispoof', 'faceres']

if (!existsSync(from)) {
  console.warn('[copy-human-models] @vladmandic/human is not installed; face identity checks will report unavailable.')
  process.exit(0)
}
mkdirSync(to, { recursive: true })
let copied = 0
for (const name of MODELS) {
  for (const ext of ['json', 'bin']) {
    const src = join(from, `${name}.${ext}`)
    const dst = join(to, `${name}.${ext}`)
    if (existsSync(dst) && statSync(dst).size === statSync(src).size) continue
    copyFileSync(src, dst)
    copied++
  }
}
console.log(`[copy-human-models] ${copied ? `copied ${copied} file(s)` : 'up to date'} → public/models/human`)
