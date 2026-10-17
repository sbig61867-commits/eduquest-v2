import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en'
import { AccountPanel } from '@/components/shared/account-panel'
import type { Tenant, User } from '@/types'

// Found testing a student account on a phone (2026-10-17):
// 1. the member ID broke at its hyphen onto two lines ("QOU-" / "S79148518");
// 2. the fixed assistant button (bottom-4, 64 px) covered the last section of
//    a student page, with no room to scroll it clear.

const read = (p: string) => readFileSync(join(process.cwd(), 'src', p), 'utf8')

describe('phone layout', () => {
  it('the member ID stays on one line', () => {
    const user = { id: 'u', full_name: 'S', email: 's@x.test', member_code: 'QOU-S79148518', role: 'student' } as unknown as User
    render(<NextIntlClientProvider locale="en" messages={en}><AccountPanel user={user} tenant={null as unknown as Tenant} /></NextIntlClientProvider>)
    const code = screen.getByText('QOU-S79148518')
    expect(code.className).toContain('whitespace-nowrap')
    expect(code.className).toContain('min-w-0')
  })

  it('student pages leave room under the last section for the assistant button', () => {
    const layout = read('app/(student)/layout.tsx')
    expect(layout).toContain('<AssistantOrb')
    const main = /<main className="([^"]+)"/.exec(layout)?.[1] ?? ''
    // 96 px of bottom padding ≥ the button's 16 px offset + 64 px height.
    expect(main.split(/\s+/)).toEqual(expect.arrayContaining(['pb-24', 'lg:pb-24']))
    const orb = read('components/assistant/assistant-orb.tsx')
    expect(orb).toContain('fixed bottom-4 end-4')
  })
})
