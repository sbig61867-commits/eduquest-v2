import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The teacher's lesson page in a narrow window (owner, 2026-10-18): the header,
// the tabs and each block's toolbar pushed buttons past the right edge, so the
// whole page scrolled sideways. They must wrap or scroll inside themselves.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const page = read('src/app/(teacher)/teacher/lessons/[id]/lesson-detail-client.tsx')
const builder = read('src/components/lesson/lesson-builder.tsx')

describe('lesson page fits any window width', () => {
  it('the header wraps and the title can shrink', () => {
    expect(page).toContain('<div className="flex flex-wrap items-center gap-3">')
    expect(page).toContain('flex-1 min-w-0 basis-40')
  })

  it('the tabs scroll inside their own row', () => {
    expect(page).toMatch(/<div className="flex overflow-x-auto[^"]*border-b/)
    expect(page).toContain('shrink-0 whitespace-nowrap')
  })

  it('a block toolbar wraps, and wide block content scrolls inside the card', () => {
    expect(builder).toContain('<header className="flex flex-wrap items-center gap-1')
    expect(builder).toContain('<div className="p-3 min-w-0 overflow-x-auto">')
  })
})
