// A fake Supabase for the local lesson tests — Node core only, loopback only.
//
// Serves exactly the Auth + PostgREST calls the teacher lesson page makes, from
// an in-memory fixture (a made-up institution, teacher and group: no real data).
// Any request it does not recognise is answered 501 AND recorded as a
// violation; the Playwright run fails on any violation.
//
// Auth: an ES256 key pair is generated on start (never stored); its public JWK
// is served as the project's JWKS, and /__eqtest/session hands the test a
// session signed with it, so `getClaims()` verifies it exactly as in production.
//
// Control endpoints (test only): POST /__eqtest/reset {lesson, as: {role, is_active}}, GET /__eqtest/state,
// POST /__eqtest/mode {lessonUpdate: 'ok'|'error'|'hold'}, POST /__eqtest/release.
import http from 'node:http'
import { generateKeyPairSync, sign, randomUUID } from 'node:crypto'

const PORT = Number(process.env.EQ_FAKE_SUPABASE_PORT ?? 54399)
const HOST = '127.0.0.1'

export const IDS = {
  tenant: '11111111-1111-4111-8111-111111111111',
  teacher: '22222222-2222-4222-8222-222222222222',
  group: '33333333-3333-4333-8333-333333333333',
  lesson: '44444444-4444-4444-8444-444444444444',
}

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const KID = 'eqtest-' + randomUUID().slice(0, 8)
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'ES256', use: 'sig', key_ops: ['verify'] }

const b64u = buf => Buffer.from(buf).toString('base64url')
function signJwt(payload) {
  const head = b64u(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid: KID }))
  const body = b64u(JSON.stringify(payload))
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' })
  return `${head}.${body}.${b64u(sig)}`
}

// The signed-in account. Default: the fixture teacher (the lesson tests). The
// security tests switch it per test through POST /__eqtest/reset {as: {...}}:
// a made-up id per role, the role and is_active in the JWT claims exactly as
// the sync_user_claims trigger writes them in production (app_metadata).
const ROLE_IDS = {
  teacher: IDS.teacher,
  student: '55555555-5555-4555-8555-555555555555',
  university_admin: '66666666-6666-4666-8666-666666666666',
  super_admin: '77777777-7777-4777-8777-777777777777',
  center_manager: '88888888-8888-4888-8888-888888888888',
}
// is_active rides in the JWT; live_is_active is the row in public.users. They
// differ for an account disabled after its token was minted (stale token).
let as = { role: 'teacher', is_active: true, live_is_active: true }
const currentId = () => ROLE_IDS[as.role] ?? IDS.teacher
const currentTenant = () => (as.role === 'super_admin' ? null : IDS.tenant)
const appMeta = () => ({
  provider: 'email', providers: ['email'], user_role: as.role, role: as.role, is_active: as.is_active, tenant_id: currentTenant(),
})
const currentUser = () => ({
  id: currentId(), aud: 'authenticated', role: 'authenticated', email: `${as.role}@eqtest.invalid`,
  app_metadata: appMeta(), user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
})
function session() {
  const now = Math.floor(Date.now() / 1000)
  const user = currentUser()
  const access_token = signJwt({
    aud: 'authenticated', exp: now + 3600, iat: now, iss: `http://${HOST}:${PORT}/auth/v1`, sub: user.id,
    email: user.email, role: 'authenticated', app_metadata: user.app_metadata, user_metadata: {}, aal: 'aal1', session_id: randomUUID(),
  })
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: 'eqtest-refresh', user }
}

const TENANT = {
  id: IDS.tenant, name: 'EQTEST Institution', is_active: true, institution_type: 'university', has_center: true,
  structure_mode: 'flat', default_locale: 'ar', code: 'EQT', student_limit: null, teacher_limit: null,
}
const profile = () => ({
  id: currentId(), email: `${as.role}@eqtest.invalid`, full_name: `EQTEST ${as.role}`, role: as.role, tenant_id: currentTenant(),
  is_active: as.live_is_active, avatar_url: null, locale: null, permissions: {}, can_create_courses: true,
  is_university_student: true, member_code: 'EQT-T00000000', name_complete: true, created_at: '2026-01-01T00:00:00Z',
  tenants: currentTenant() ? TENANT : null,
})
const GROUP = { id: IDS.group, name: 'EQTEST Group', teacher_id: IDS.teacher, tenant_id: IDS.tenant, is_active: true }

let state
let mode = { lessonUpdate: 'ok' }
let held = []
const requests = []
const violations = []
const ROLES = new Set(Object.keys(ROLE_IDS))
function reset(lessonOverrides = {}, asOverride = {}) {
  as = {
    role: ROLES.has(asOverride.role) ? asOverride.role : 'teacher',
    is_active: asOverride.is_active === false ? false : true,
    live_is_active: asOverride.live_is_active === false || asOverride.is_active === false ? false : true,
  }
  state = {
    lesson: {
      id: IDS.lesson, tenant_id: IDS.tenant, group_id: IDS.group, teacher_id: IDS.teacher,
      title: 'ls9', content: '', media_urls: [], is_published: false, created_at: '2026-10-09T10:00:00Z', deleted_at: null,
      ...lessonOverrides,
    },
    updates: [],
  }
  mode = { lessonUpdate: 'ok' }
  for (const release of held) release()
  held = []
  requests.length = 0
  violations.length = 0
}
reset()

function lessonRow(select) {
  const row = { ...state.lesson }
  if (/groups/.test(select ?? '')) row.groups = { id: GROUP.id, name: GROUP.name }
  return row
}

// CORS for the browser client on the app origin. `Access-Control-Allow-Headers: *`
// does NOT cover Authorization (Fetch spec), so the requested headers are echoed.
function send(res, status, body, headers = {}) {
  const text = body === undefined ? '' : JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json', 'access-control-allow-origin': 'http://127.0.0.1:3123',
    'access-control-allow-headers': res.eqCors || 'authorization, apikey, content-type, accept, accept-profile, content-profile, prefer, range, x-client-info, x-supabase-api-version',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS, HEAD', 'access-control-expose-headers': 'content-range, content-profile',
    vary: 'Origin, Access-Control-Request-Headers', ...headers,
  })
  res.end(text)
}
// PostgREST shape: object when the client asked for one row, else a list.
function rows(req, res, list) {
  const single = /vnd\.pgrst\.object/.test(req.headers.accept ?? '')
  if (single) return list.length === 1 ? send(res, 200, list[0]) : send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' })
  return send(res, 200, list, { 'content-range': `0-${Math.max(0, list.length - 1)}/${list.length}` })
}
function violation(req, why) {
  violations.push({ method: req.method, url: req.url, why })
  return null
}

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString('utf8')
  try { return raw ? JSON.parse(raw) : null } catch { return raw }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  const path = url.pathname
  res.eqCors = String(req.headers['access-control-request-headers'] ?? '') // per request, no shared state
  if (req.method === 'OPTIONS') return send(res, 204)

  // ── test control ──
  if (path === '/__eqtest/reset') { const b = await readBody(req); reset(b?.lesson ?? {}, b?.as ?? {}); return send(res, 200, { ok: true, as }) }
  if (path === '/__eqtest/session') return send(res, 200, session())
  if (path === '/__eqtest/state') return send(res, 200, { lesson: state.lesson, updates: state.updates, requests, violations })
  if (path === '/__eqtest/mode') { mode = { ...mode, ...(await readBody(req)) }; return send(res, 200, mode) }
  if (path === '/__eqtest/release') { const n = held.length; for (const r of held) r(); held = []; return send(res, 200, { released: n }) }
  if (path === '/__eqtest/health') return send(res, 200, { ok: true })

  const body = await readBody(req)
  requests.push({ method: req.method, path, query: url.search })

  // ── auth ──
  if (path === '/auth/v1/.well-known/jwks.json') return send(res, 200, { keys: [jwk] })
  if (path === '/auth/v1/user' && req.method === 'GET') return send(res, 200, currentUser())
  if (path === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') return send(res, 200, session())
  if (path === '/auth/v1/logout') return send(res, 204)

  // ── PostgREST ──
  const m = path.match(/^\/rest\/v1\/(rpc\/)?([a-z_]+)$/)
  if (m) {
    const [, rpc, name] = m
    const select = url.searchParams.get('select') ?? ''
    if (rpc) {
      if (name === 'get_my_notifications') return send(res, 200, {})
      violation(req, `rpc ${name}`); return send(res, 501, { message: `eqtest: rpc ${name} not mocked` })
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      if (name === 'users') return rows(req, res, [profile()])
      if (name === 'tenants') return rows(req, res, [TENANT])
      if (name === 'groups') return rows(req, res, [GROUP])
      if (name === 'exams') return rows(req, res, [])
      if (name === 'lessons') return rows(req, res, state.lesson.deleted_at ? [] : [lessonRow(select)])
    }
    if (req.method === 'PATCH' && name === 'lessons') {
      if (url.searchParams.get('id') !== `eq.${IDS.lesson}`) { violation(req, 'PATCH lessons without the fixture id'); return send(res, 501, {}) }
      if (mode.lessonUpdate === 'error') return send(res, 500, { code: 'XX000', message: 'eqtest: forced failure' })
      if (mode.lessonUpdate === 'hold') await new Promise(r => held.push(r))
      state.updates.push({ at: Date.now(), body })
      Object.assign(state.lesson, body)
      return rows(req, res, [lessonRow(select)])
    }
  }

  violation(req, 'not mocked')
  return send(res, 501, { message: `eqtest: ${req.method} ${path} not mocked` })
})

server.listen(PORT, HOST, () => console.log(`[fake-supabase] listening on http://${HOST}:${PORT}`))
