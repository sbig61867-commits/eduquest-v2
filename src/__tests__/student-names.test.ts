import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { saveStudentName } from '@/lib/student-names'

const parts = { first: 'أحمد', father: 'محمود', grandfather: 'صالح', family: 'الخطيب' }

/** A service-role client stub recording the student_names upsert and the users update. */
function stubAdmin(upsertError: { code?: string; message: string } | null, updateError: { message: string } | null = null) {
  const calls: { upsert?: Record<string, unknown>; update?: Record<string, unknown>; id?: string } = {}
  const client = {
    from: vi.fn((table: string) => table === 'student_names'
      ? { upsert: vi.fn(async (row: Record<string, unknown>) => { calls.upsert = row; return { error: upsertError } }) }
      : {
          update: vi.fn((row: Record<string, unknown>) => {
            calls.update = row
            return { eq: vi.fn(async (_col: string, id: string) => { calls.id = id; return { error: updateError } }) }
          }),
        }),
  }
  return { client: client as unknown as SupabaseClient, calls }
}

describe('saveStudentName', () => {
  it('keeps the four parts private and gives the profile first + family name', async () => {
    const { client, calls } = stubAdmin(null)
    await expect(saveStudentName(client, 'u1', parts)).resolves.toBe('أحمد الخطيب')
    expect(calls.upsert).toMatchObject({
      user_id: 'u1', first_name: 'أحمد', father_name: 'محمود', grandfather_name: 'صالح', family_name: 'الخطيب',
    })
    expect(calls.update).toEqual({ full_name: 'أحمد الخطيب', name_complete: true })
    expect(calls.id).toBe('u1')
  })

  it('before the migration, keeps the whole name rather than lose the middle names', async () => {
    const { client, calls } = stubAdmin({ code: 'PGRST205', message: "Could not find the table 'public.student_names'" })
    await expect(saveStudentName(client, 'u1', parts)).resolves.toBe('أحمد محمود صالح الخطيب')
    expect(calls.update).toEqual({ full_name: 'أحمد محمود صالح الخطيب' })
  })

  it('fails loudly on any other storage error', async () => {
    const { client, calls } = stubAdmin({ code: '23503', message: 'foreign key violation' })
    await expect(saveStudentName(client, 'u1', parts)).rejects.toThrow('student_names')
    expect(calls.update).toBeUndefined()
  })

  it('fails when the profile row cannot be updated', async () => {
    const { client } = stubAdmin(null, { message: 'boom' })
    await expect(saveStudentName(client, 'u1', parts)).rejects.toThrow('users.full_name')
  })
})
