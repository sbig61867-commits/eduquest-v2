/**
 * Security — codebase-wide invariants.
 *
 * The other two security suites test logic that exists today. This one tests
 * the rules that must keep holding as the codebase grows: it walks the real
 * source tree and fails when a NEW file breaks a rule an existing file
 * respects. That is the difference between an audit (a snapshot) and a
 * regression guard (a ratchet).
 *
 * Every invariant here corresponds to a class of bug this project has
 * actually shipped or narrowly avoided, recorded in CLAUDE.md and the audit
 * documents:
 *
 *  I1  A route handler that forgets to authenticate. The proxy gates page
 *      navigations, but `/api/*` is NOT covered by ROLE_ROUTES — a route
 *      that skips its own check is open to any signed-in user of any role.
 *  I2  The service-role key reaching client code. It bypasses RLS entirely;
 *      shipping it to a browser bundle ends tenant isolation outright.
 *  I3  A SECURITY DEFINER function without a pinned search_path. Documented
 *      in CLAUDE.md as the cause of silent platform-wide 403s.
 *  I4  A table with RLS enabled but no policy, or a policy file that grants
 *      to `anon`.
 *  I5  Secrets committed to the tree. A production Postgres password already
 *      reached this PUBLIC repo once and sat there ~2.5 months.
 *  I6  Raw string interpolation into a PostgREST `.or()` filter — the shape
 *      that let a search box widen a tenant-scoped query.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(__dirname, '..', '..')
const SRC = join(ROOT, 'src')
const SUPABASE_DIR = join(ROOT, 'supabase')

function walk(dir: string, match: (f: string) => boolean): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next' || entry === '.git') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full, match))
    else if (match(entry)) out.push(full)
  }
  return out
}

const read = (f: string) => readFileSync(f, 'utf8')
const rel = (f: string) => relative(ROOT, f)

const ROUTE_FILES = walk(join(SRC, 'app', 'api'), f => f === 'route.ts')

/** Capability names as lib/permissions.ts declares them, read from source. */
const CAPABILITY_NAMES: string[] = (() => {
  const src = readFileSync(join(SRC, 'lib', 'permissions.ts'), 'utf8')
  const block = src.split('export const CAPABILITIES')[1]?.split(']')[0] ?? ''
  return [...block.matchAll(/'([a-z_]+)'/g)].map(m => m[1])
})()
const TS_FILES = walk(SRC, f => f.endsWith('.ts') || f.endsWith('.tsx'))
const SQL_FILES = walk(SUPABASE_DIR, f => f.endsWith('.sql'))

/**
 * Routes the proxy explicitly serves without a session (PUBLIC_PREFIXES in
 * src/proxy.ts). They authorize by other means — a single-use invitation
 * token, or IP rate limiting on an anonymous form — so the "must call
 * getUser" rule does not apply. Anything added here is a deliberate decision
 * that should be argued for in review, which is the point of listing it.
 */
const INTENTIONALLY_PUBLIC_ROUTES = new Set([
  'src/app/api/auth/accept-invitation/route.ts',
  'src/app/api/auth/forgot-password/route.ts',
  'src/app/api/contact/route.ts',
])

describe('I1 — every API route authenticates the caller', () => {
  it('found the route handlers to check', () => {
    expect(ROUTE_FILES.length).toBeGreaterThan(30)
  })

  it('has no route handler that skips authentication', () => {
    const offenders = ROUTE_FILES.filter(f => {
      if (INTENTIONALLY_PUBLIC_ROUTES.has(rel(f))) return false
      const src = read(f)
      // Either the Supabase auth call directly, or the shared getAuthUser helper.
      return !/auth\.getUser\(|auth\.getClaims\(|getAuthUser\(/.test(src)
    })
    expect(offenders.map(rel)).toEqual([])
  })

  it('has no public route that skips BOTH authentication and rate limiting', () => {
    // An anonymous endpoint with neither is a free amplifier.
    for (const relPath of INTENTIONALLY_PUBLIC_ROUTES) {
      const full = join(ROOT, relPath)
      const src = read(full)
      const guarded = /rateLimit\(|aiRateLimit\(|token/i.test(src)
      expect(guarded, `${relPath} is public with no rate limit and no token check`).toBe(true)
    }
  })

  it('never authorizes with the service-role client — it is only ever used to write', () => {
    // The documented pattern: authenticate + authorize with the USER session,
    // then perform the privileged write with the admin client. A route that
    // reads the caller's own role through the admin client has inverted it.
    const offenders = ROUTE_FILES.filter(f => {
      if (INTENTIONALLY_PUBLIC_ROUTES.has(rel(f))) return false
      const src = read(f)
      if (!src.includes('SUPABASE_SERVICE_ROLE_KEY')) return false
      // The caller's identity must come from the user-session client.
      return !/auth\.getUser\(|auth\.getClaims\(|getAuthUser\(/.test(src)
    })
    expect(offenders.map(rel)).toEqual([])
  })
})

describe('I2 — the service-role key never reaches client code', () => {
  it('is absent from every file marked "use client"', () => {
    const offenders = TS_FILES.filter(f => {
      const src = read(f)
      return /^['"]use client['"]/m.test(src) && src.includes('SUPABASE_SERVICE_ROLE_KEY')
    })
    expect(offenders.map(rel)).toEqual([])
  })

  it('is never named with a NEXT_PUBLIC_ prefix anywhere', () => {
    // NEXT_PUBLIC_ inlines a value into the browser bundle at build time.
    const offenders = TS_FILES.filter(f => /NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(read(f)))
    expect(offenders.map(rel)).toEqual([])
    const envExample = read(join(ROOT, '.env.example'))
    expect(envExample).not.toMatch(/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/)
  })

  it('is absent from hooks and components entirely', () => {
    const clientDirs = [join(SRC, 'components'), join(SRC, 'hooks')]
    const offenders = clientDirs
      .flatMap(d => walk(d, f => f.endsWith('.ts') || f.endsWith('.tsx')))
      .filter(f => read(f).includes('SUPABASE_SERVICE_ROLE_KEY'))
    expect(offenders.map(rel)).toEqual([])
  })
})

/**
 * Migration files whose SECURITY DEFINER bodies predate the search_path fixes.
 * Each function they define is re-created WITH a pinned search_path by a later
 * file (proved by the second test below), so the live database is correct —
 * but because migrations here are applied by hand, re-running one of these
 * files would silently revert the fix and take every dependent RLS policy
 * down with it. This list is therefore the machine-checked "do NOT re-run"
 * registry, and it must only ever shrink.
 */
const SUPERSEDED_UNPINNED_DEFINITIONS = new Set([
  'supabase/cron_cleanup.sql :: cleanup_expired_invitations',
  'supabase/fix_rpc_error_codes.sql :: get_invitation_by_token',
  'supabase/fixes_migration.sql :: handle_new_user',
  'supabase/fixes_migration.sql :: get_invitation_by_token',
  'supabase/invitations_migration.sql :: handle_new_user',
  'supabase/invitations_migration.sql :: accept_invitation',
  'supabase/invitations_migration.sql :: get_invitation_by_token',
  'supabase/jwt_claims_migration.sql :: sync_user_claims',
  'supabase/phase1_migration.sql :: get_invitation_by_token',
  'supabase/phase1_migration.sql :: accept_invitation',
  'supabase/platform_hardening_migration.sql :: check_rate_limit',
  'supabase/platform_hardening_migration.sql :: start_exam_attempt',
  'supabase/platform_hardening_migration.sql :: append_proctoring_events',
  'supabase/platform_hardening_migration.sql :: finalize_exam_submission',
])

/** Every SECURITY DEFINER definition in the SQL tree, pinned or not. */
function securityDefinerDefinitions(): Array<{ id: string; fn: string; pinned: boolean }> {
  const out: Array<{ id: string; fn: string; pinned: boolean }> = []
  for (const f of SQL_FILES) {
    const bodies = read(f).split(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i).slice(1)
    for (const body of bodies) {
      if (!/SECURITY\s+DEFINER/i.test(body)) continue
      const fn = body.trim().split(/[\s(]/)[0].replace(/^public\./, '')
      out.push({
        id: `${rel(f)} :: ${fn}`,
        fn,
        // Accept both `SET search_path = ...` and `SET search_path TO ...`.
        pinned: /SET\s+search_path\s*(?:=|TO)\s/i.test(body),
      })
    }
  }
  return out
}

describe('I3 — every SECURITY DEFINER function pins its search_path', () => {
  it('found the migration files to check', () => {
    expect(SQL_FILES.length).toBeGreaterThan(20)
    expect(securityDefinerDefinitions().length).toBeGreaterThan(20)
  })

  it('introduces no NEW unpinned SECURITY DEFINER function', () => {
    // A new entry here means a fresh instance of the bug class that once
    // 403'd every teacher write on the live platform.
    const offenders = securityDefinerDefinitions()
      .filter(d => !d.pinned)
      .map(d => d.id)
      .filter(id => !SUPERSEDED_UNPINNED_DEFINITIONS.has(id))
    expect(offenders).toEqual([])
  })

  it('has a pinned definition for every function that is unpinned somewhere', () => {
    // Proves the LIVE state is safe: no function exists only in an unpinned
    // form. If this fails, some RPC on production is running unpinned.
    const defs = securityDefinerDefinitions()
    const pinnedNames = new Set(defs.filter(d => d.pinned).map(d => d.fn))
    const unpinnedOnly = [...new Set(defs.filter(d => !d.pinned).map(d => d.fn))]
      .filter(fn => !pinnedNames.has(fn))
    expect(unpinnedOnly).toEqual([])
  })

  it('keeps the superseded list honest — no stale entry that is now pinned', () => {
    // Stops the allowlist from quietly becoming a blanket exemption.
    const unpinned = new Set(securityDefinerDefinitions().filter(d => !d.pinned).map(d => d.id))
    const stale = [...SUPERSEDED_UNPINNED_DEFINITIONS].filter(id => !unpinned.has(id))
    expect(stale).toEqual([])
  })
})

describe('I4 — SQL never widens access to anonymous callers', () => {
  it('never grants EXECUTE or table privileges to anon', () => {
    const offenders: string[] = []
    for (const f of SQL_FILES) {
      for (const line of read(f).split('\n')) {
        if (/^\s*--/.test(line)) continue
        if (/\bGRANT\b[\s\S]*\bTO\b[^;]*\banon\b/i.test(line)) offenders.push(`${rel(f)}: ${line.trim()}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('never creates a policy whose role list includes anon', () => {
    const offenders: string[] = []
    for (const f of SQL_FILES) {
      const stmts = read(f).split(/CREATE\s+POLICY/i).slice(1)
      for (const s of stmts) {
        const head = s.split(/USING|WITH\s+CHECK/i)[0]
        if (/\bTO\b[^;]*\banon\b/i.test(head)) {
          offenders.push(`${rel(f)}: ${head.trim().slice(0, 80)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps the answer key out of any policy granted to students', () => {
    // correct_answer must never be selectable client-side; grading is
    // server-authoritative. Guard the column name against a policy that
    // would hand the exams row to a student directly.
    const schema = read(join(SUPABASE_DIR, 'schema.sql'))
    expect(schema).toMatch(/correct_answer/i)
    const studentExamSelect = /CREATE\s+POLICY[^;]*exams[^;]*FOR\s+SELECT[^;]*student/i
    const offenders = SQL_FILES.filter(f => {
      const src = read(f)
      // A policy naming both `exams` and the student role for SELECT is the
      // shape that leaked answers before; it must be introduced deliberately.
      return studentExamSelect.test(src) && !/get_student_exams/i.test(src)
    })
    expect(offenders.map(rel)).toEqual([])
  })
})

describe('I5 — no secrets in the tree', () => {
  const SECRET_PATTERNS: Array<[string, RegExp]> = [
    ['Supabase service-role JWT', /eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\.[A-Za-z0-9_-]{40,}/],
    ['Postgres connection string with a password', /postgres(?:ql)?:\/\/[^:\s]+:[^@\s]{6,}@/],
    ['Groq API key', /\bgsk_[A-Za-z0-9]{20,}/],
    ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}/],
    ['Resend API key', /\bre_[A-Za-z0-9]{20,}/],
    ['LiveKit API secret', /\bAPI[A-Za-z0-9]{32,}\b/],
  ]

  const SCANNED = [
    ...TS_FILES,
    ...SQL_FILES,
    ...walk(ROOT, f => f.endsWith('.md')).filter(f => !f.includes('node_modules')),
    join(ROOT, '.env.example'),
  ]

  it('finds no live-looking credential in any source, SQL or docs file', () => {
    const offenders: string[] = []
    for (const f of SCANNED) {
      const src = read(f)
      for (const [label, pattern] of SECRET_PATTERNS) {
        const hit = src.match(pattern)
        if (hit) offenders.push(`${rel(f)}: ${label}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('keeps .env files out of git', () => {
    const gitignore = read(join(ROOT, '.gitignore'))
    expect(gitignore).toMatch(/\.env/)
  })

  it('ships .env.example with placeholders only, never real values', () => {
    const src = read(join(ROOT, '.env.example'))
    for (const line of src.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.+)$/)
      if (!m) continue
      const [, key, value] = m
      const looksPlaceholder = /your|example|localhost|YOUR|<|placeholder|false|true/i.test(value)
      expect(looksPlaceholder, `${key} in .env.example looks like a real value`).toBe(true)
    }
  })
})

describe('I6 — user input never lands unescaped in a PostgREST filter', () => {
  it('escapes or strips input before every .or() filter built from a template literal', () => {
    // `.or()` takes raw PostgREST filter syntax: an unescaped comma, dot or
    // parenthesis in user input adds conditions and can widen a tenant scope.
    const offenders: string[] = []
    for (const f of TS_FILES) {
      const src = read(f)
      const calls = src.match(/\.or\(\s*`[^`]*`/g) ?? []
      for (const call of calls) {
        // Only user-supplied values are a filter-injection risk. A
        // server-derived value (a timestamp, a session id) is not.
        const interpolated = call.match(/\$\{([^}]+)\}/g) ?? []
        const userDerived = interpolated.some(v =>
          /search|query|term|q\b|name|email|input|body|param|filter/i.test(v),
        )
        if (!userDerived) continue
        // The interpolated identifier must have been sanitized nearby.
        const sanitized = /\.replace\(\/\[|sanitiz|escapeFilter|safe/i.test(src)
        if (!sanitized) offenders.push(`${rel(f)}: ${call.slice(0, 70)}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('never interpolates a raw request value straight into .eq() on tenant_id', () => {
    // tenant_id must come from the verified session, never from the body or
    // query string, or a caller picks their own tenant.
    const offenders: string[] = []
    for (const f of ROUTE_FILES) {
      const src = read(f)
      // Flag a route that reads tenant_id from input AND uses it to scope a
      // query without also deriving the caller's own tenant from the session.
      const readsFromInput = /body\.tenant_id|searchParams\.get\(['"]tenant_id['"]\)/.test(src)
      if (!readsFromInput) continue
      const verifies = /user\.tenant_id|profile\?\.tenant_id|role !== ['"]?super_admin|=== ['"]super_admin/.test(src)
      if (!verifies) offenders.push(rel(f))
    }
    expect(offenders).toEqual([])
  })
})

/**
 * Capabilities that lib/permissions.ts declares — with a label, a hint, and a
 * toggle rendered in the admin UI — but which NO route handler or data module
 * actually checks. A capability in this state is worse than a missing one: the
 * owner switches it off, the UI reports it off, and the underlying route keeps
 * allowing the action because it gates on a hardcoded role list instead.
 *
 * Verified 2026-09-12: the five below are declared and rendered but enforced
 * nowhere; the routes they name (create-user, toggle-user, groups,
 * group-students, invitations, reports) authorize by role only. That also
 * means granting one to a center_manager does nothing, because those same
 * role lists exclude center_manager entirely — the flag is inert in BOTH
 * directions.
 *
 * This list must only ever shrink. Each entry removed is a capability that
 * became a real control.
 */
const UNENFORCED_CAPABILITIES = new Set([
  'manage_teachers',
  'manage_students',
  'manage_groups',
  'manage_invitations',
  'view_reports',
])

describe('I7 — every declared capability is actually enforced somewhere', () => {
  /** Files that could enforce a capability: route handlers and data modules. */
  const ENFORCEMENT_FILES = [
    ...ROUTE_FILES,
    ...walk(join(SRC, 'lib'), f => f.endsWith('.ts')),
    ...walk(join(SRC, 'app'), f => f.endsWith('.tsx')),
  ].filter(f => !f.includes('permissions.ts'))

  function enforcedCapabilities(): Set<string> {
    const found = new Set<string>()
    const declared = read(join(SRC, 'lib', 'permissions.ts'))
      .match(/^\s*'([a-z_]+)',$/gm)
      ?.map(l => l.trim().replace(/[',]/g, '')) ?? []
    for (const f of ENFORCEMENT_FILES) {
      const src = read(f)
      for (const cap of declared) {
        if (src.includes(`'${cap}'`) || src.includes(`"${cap}"`)) found.add(cap)
      }
    }
    return found
  }

  it('found the capability list and some enforcement sites', () => {
    expect(CAPABILITY_NAMES.length).toBeGreaterThan(4)
    expect(ENFORCEMENT_FILES.length).toBeGreaterThan(50)
  })

  it('introduces no NEW capability that is declared but never checked', () => {
    const enforced = enforcedCapabilities()
    const inert = CAPABILITY_NAMES
      .filter(c => !enforced.has(c))
      .filter(c => !UNENFORCED_CAPABILITIES.has(c))
    expect(inert).toEqual([])
  })

  it('keeps the unenforced list honest — no stale entry that is now checked', () => {
    // Once a capability gains a real check, it must leave the list, so the
    // list always states the true size of the gap.
    const enforced = enforcedCapabilities()
    const stale = [...UNENFORCED_CAPABILITIES].filter(c => enforced.has(c))
    expect(stale).toEqual([])
  })

  it('does not let the unenforced list grow to cover every capability', () => {
    // A guard against "fixing" a failure by adding the name to the allowlist
    // until the whole model is exempt.
    expect(UNENFORCED_CAPABILITIES.size).toBeLessThan(CAPABILITY_NAMES.length)
  })
})
