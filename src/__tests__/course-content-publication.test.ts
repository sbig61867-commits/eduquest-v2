import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * A: a student reads a course level / unit / item only when its whole publication chain is published
 * (supabase/a_unpublished_course_content_migration.sql). Every other role keeps the pre-A predicate exactly: each
 * policy is the rollback's predicate AND (role is not 'student' OR chain). This keeps the migration, its rollback and
 * the database check (supabase/tests/course_content_publication_check.sql, which switches between both forms) in step.
 */
const MIGRATION = 'supabase/a_unpublished_course_content_migration.sql'
const ROLLBACK = 'supabase/a_unpublished_course_content_rollback.sql'
const CHECK = 'supabase/tests/course_content_publication_check.sql'

const POLICIES = [
  { name: 'course_levels_select', table: 'course_levels', chain: ['course_levels.is_published'] },
  { name: 'course_units_select', table: 'course_units', chain: ['course_units.is_published', 'l.is_published'] },
  { name: 'unit_items_select', table: 'unit_items', chain: ['unit_items.is_published', 'pu.is_published', 'pl.is_published'] },
]

const withoutComments = (sql: string) => sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')

/** Comparable token stream: no whitespace, parentheses or schema prefix. */
const tokens = (sql: string) => sql.toLowerCase().replace(/public\./g, '').replace(/[\s()]/g, '')

function usingClause(sql: string, policy: string, table: string): string {
  const m = sql.match(new RegExp(`ALTER POLICY ${policy} ON public\\.${table} USING \\(`))
  expect(m, `${policy} statement not found`).toBeTruthy()
  let depth = 1
  const start = m!.index! + m![0].length
  for (let i = start; i < sql.length; i++) {
    if (sql[i] === '(') depth++
    if (sql[i] === ')' && --depth === 0) return sql.slice(start, i)
  }
  throw new Error('unbalanced USING clause')
}

/** The ALTER POLICY strings of one text[] constant in the check, with '' unescaped. */
function checkStatements(check: string, constant: 'pre_sql' | 'a_sql'): string {
  const block = check.match(new RegExp(`${constant} CONSTANT text\\[\\] := ARRAY\\[([\\s\\S]*?)\\];`))
  expect(block, `${constant} not found in the check`).toBeTruthy()
  return [...block![1].matchAll(/'((?:[^']|'')*)'/g)].map(m => m[1].replace(/''/g, "'")).join(';\n')
}

describe('unpublished course content (A)', () => {
  const migration = withoutComments(readFileSync(MIGRATION, 'utf8'))
  const rollback = withoutComments(readFileSync(ROLLBACK, 'utf8'))
  const check = readFileSync(CHECK, 'utf8')

  it('the migration is exactly three ALTER POLICY statements on the three SELECT policies', () => {
    const statements = migration.split(';').map(s => s.trim()).filter(Boolean)
    expect(statements).toHaveLength(3)
    POLICIES.forEach((p, i) => expect(statements[i]).toMatch(new RegExp(`^ALTER POLICY ${p.name} ON public\\.${p.table} USING \\(`)))
    expect(migration).not.toMatch(/\b(CREATE|DROP|GRANT|REVOKE|INSERT|UPDATE|DELETE|TRUNCATE)\b/i)
  })

  it.each(POLICIES)('$name keeps the pre-A predicate and adds the student chain only', ({ name, table, chain }) => {
    const after = usingClause(migration, name, table)
    const before = usingClause(rollback, name, table)
    expect(tokens(after).startsWith(`${tokens(before)}and`)).toBe(true)
    expect(after).toMatch(/\(SELECT public\.current_user_role\(\)\) IS DISTINCT FROM 'student'/)
    expect(before).not.toMatch(/student|is_published/)
    for (const flag of chain) expect(after).toContain(flag)
  })

  it('every role helper call is wrapped in (SELECT …) — one per policy', () => {
    expect(migration.match(/current_user_role\(\)/g)).toHaveLength(3)
    expect(migration.match(/\(SELECT public\.current_user_role\(\)\)/g)).toHaveLength(3)
  })

  it('the database check switches between exactly the rollback and the migration', () => {
    expect(tokens(checkStatements(check, 'pre_sql'))).toBe(tokens(rollback.trim().replace(/;$/, '')))
    expect(tokens(checkStatements(check, 'a_sql'))).toBe(tokens(migration.trim().replace(/;$/, '')))
  })
})
