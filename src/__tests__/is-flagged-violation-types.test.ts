import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { VIOLATION_TYPES, SIGNAL_TYPES, INFO_TYPES } from '@/lib/proctoring-events'

/**
 * exam_submissions.is_flagged is a generated column whose expression lists the
 * violation types (supabase/is_flagged_generated_migration.sql, mirrored in
 * schema.sql). The database cannot read TypeScript, so this keeps the two lists
 * identical: a type added on one side only fails here.
 */
function typesIn(file: string): string[] {
  const sql = readFileSync(file, 'utf8')
  const expr = sql.match(/ADD COLUMN is_flagged BOOLEAN GENERATED ALWAYS AS \(([\s\S]*?)\) STORED/)
  expect(expr, `${file}: is_flagged generated expression not found`).toBeTruthy()
  return [...expr![1].matchAll(/@\.type == "([a-z_]+)"/g)].map(m => m[1])
}

describe('is_flagged violation list', () => {
  for (const file of ['supabase/is_flagged_generated_migration.sql', 'supabase/schema.sql']) {
    it(`${file} lists exactly VIOLATION_TYPES`, () => {
      const types = typesIn(file)
      expect(new Set(types).size).toBe(types.length)
      expect([...types].sort()).toEqual([...VIOLATION_TYPES].sort())
      for (const t of [...SIGNAL_TYPES, ...INFO_TYPES]) expect(types).not.toContain(t)
    })
  }
})
