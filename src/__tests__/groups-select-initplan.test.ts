import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * P-09: groups_select must call current_user_role() / current_tenant_id() through (SELECT …), so they run once per
 * query. group_students_select reads groups for every membership row; a bare call there costs ~1 s for a per-group
 * member count at 1 000 groups (supabase/groups_select_initplan_migration.sql, mirrored in schema.sql). This keeps
 * the migration and schema.sql wrapped, and keeps the predicate itself identical to the pre-P-09 definition that the
 * migration's rollback restores — only the wrappers differ. The database check is
 * supabase/tests/groups_select_initplan_check.sql.
 */
const MIGRATION = 'supabase/groups_select_initplan_migration.sql'
const HELPERS = /current_user_role\(\)|current_tenant_id\(\)/g

const withoutComments = (sql: string) => sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

/** Comparable token stream: no whitespace, parentheses, schema prefix, casts or column aliases; != as <>. */
function tokens(predicate: string): string {
  return predicate
    .toLowerCase()
    .replace(/\bas current_[a-z_]+\b/g, '')
    .replace(/public\./g, '')
    .replace(/::text/g, '')
    .replace(/!=/g, '<>')
    .replace(/[\s()]/g, '')
}

/** The same predicate with every (SELECT helper()) unwrapped back to a bare call. */
const unwrap = (predicate: string) =>
  predicate.replace(/\(\s*SELECT\s+(?:public\.)?(current_user_role|current_tenant_id)\(\)(?:\s+AS\s+\w+)?\s*\)/gi, '$1()')

function bareCalls(predicate: string): number {
  return [...predicate.matchAll(HELPERS)].filter(m => !/SELECT\s+(?:public\.)?$/i.test(predicate.slice(0, m.index))).length
}

function usingClause(sql: string, opener: RegExp): string {
  const m = sql.match(opener)
  expect(m, 'policy statement not found').toBeTruthy()
  let depth = 1
  const start = m!.index! + m![0].length
  for (let i = start; i < sql.length; i++) {
    if (sql[i] === '(') depth++
    if (sql[i] === ')' && --depth === 0) return sql.slice(start, i)
  }
  throw new Error('unbalanced USING clause')
}

describe('groups_select init-plan (P-09)', () => {
  const migration = readFileSync(MIGRATION, 'utf8')
  const body = withoutComments(migration)
  const migrationUsing = usingClause(body, /ALTER POLICY groups_select ON public\.groups USING \(/)
  const rollbackUsing = usingClause(migration.split('\n').map(l => l.replace(/^--\s?/, '')).join('\n'),
    /ALTER POLICY groups_select ON public\.groups USING \(\s*(?=\(deleted_at)/)

  it('the migration is one ALTER POLICY on groups_select and nothing else', () => {
    const statements = body.split(';').map(s => s.trim()).filter(Boolean)
    expect(statements).toHaveLength(1)
    expect(statements[0]).toMatch(/^ALTER POLICY groups_select ON public\.groups USING \(/)
    expect(body).not.toMatch(/\b(CREATE|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\b/i)
  })

  it('every helper call in the migration is wrapped: 3 role calls, 1 tenant call', () => {
    expect(bareCalls(migrationUsing)).toBe(0)
    expect(migrationUsing.match(/\(SELECT public\.current_user_role\(\)\)/g)).toHaveLength(3)
    expect(migrationUsing.match(/\(SELECT public\.current_tenant_id\(\)\)/g)).toHaveLength(1)
  })

  it('the rollback in the header is the pre-P-09 predicate: same tokens once unwrapped, all calls bare', () => {
    expect(bareCalls(rollbackUsing)).toBe(4)
    expect(tokens(unwrap(migrationUsing))).toBe(tokens(rollbackUsing))
  })

  it('schema.sql mirrors the migration: wrapped, same predicate', () => {
    const schema = readFileSync('supabase/schema.sql', 'utf8')
    const schemaUsing = usingClause(schema, /CREATE POLICY "groups_select" ON groups FOR SELECT USING \(/)
    expect(bareCalls(schemaUsing)).toBe(0)
    expect(tokens(schemaUsing)).toBe(tokens(migrationUsing))
  })
})
