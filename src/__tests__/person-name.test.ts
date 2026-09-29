import { describe, expect, it } from 'vitest'
import {
  checkNameParts,
  fourPartName,
  namePartError,
  normalizeNamePart,
  shortStudentName,
} from '@/lib/person-name'

const ar = { first: 'أحمد', father: 'محمود', grandfather: 'صالح', family: 'الخطيب' }
const en = { first: 'Ahmad', father: 'Mahmoud', grandfather: 'Saleh', family: 'Al-Khatib' }

describe('namePartError', () => {
  it.each([
    ['أحمد', null],
    ['عبد الله', null],          // compound part: two words in one field
    ['مُحَمَّد', null],          // harakat are marks, not symbols
    ['مي', null],                // two letters is enough
    ['Al-Khatib', null],
    ["O'Neil", null],
    ['José', null],
    ['', 'required'],
    ['   ', 'required'],
    ['أ', 'tooShort'],
    ['M', 'tooShort'],
    ['ااا', 'repeated'],
    ['xx', 'repeated'],
    ['Ahmad2', 'invalidChars'],
    ['أحمد٣', 'invalidChars'],   // Arabic-Indic digit
    ['@hmad', 'invalidChars'],
    ['a.b', 'invalidChars'],
    ['😀😀', 'invalidChars'],
    ['Ahmadأحمد', 'invalidChars'], // two scripts inside one part
    ['Иван', 'invalidChars'],    // Arabic or Latin only
    ['a'.repeat(31), 'tooLong'],
  ])('%j → %s', (input, expected) => {
    expect(namePartError(input)).toBe(expected)
  })

  it('ignores tatweel, zero-width and bidi characters', () => {
    expect(normalizeNamePart('أحـــمد')).toBe('أحمد')
    expect(normalizeNamePart('‏أحمد​')).toBe('أحمد')
    expect(namePartError('ـــ')).toBe('required')
  })

  it('collapses inner whitespace', () => {
    expect(normalizeNamePart('  عبد    الله ')).toBe('عبد الله')
  })

  it('rejects non-string input', () => {
    expect(namePartError(42)).toBe('required')
    expect(namePartError(null)).toBe('required')
  })
})

describe('checkNameParts', () => {
  it('accepts four Arabic parts: the student sees all four, everyone else first + family', () => {
    const r = checkNameParts(ar)
    expect(r).toEqual({ ok: true, parts: ar, fullName: 'أحمد محمود صالح الخطيب', shortName: 'أحمد الخطيب' })
  })

  it('accepts four Latin parts', () => {
    const r = checkNameParts(en)
    expect(r.ok && r.fullName).toBe('Ahmad Mahmoud Saleh Al-Khatib')
    expect(r.ok && r.shortName).toBe('Ahmad Al-Khatib')
  })

  it('keeps a compound part whole, in the short name too', () => {
    const r = checkNameParts({ ...ar, first: 'عبد الله', family: 'أبو الخير' })
    expect(r.ok && r.fullName).toBe('عبد الله محمود صالح أبو الخير')
    expect(r.ok && r.shortName).toBe('عبد الله أبو الخير')
  })

  it('never puts a middle name in the short name', () => {
    const r = checkNameParts(ar)
    expect(r.ok && r.shortName).not.toContain(ar.father)
    expect(r.ok && r.shortName).not.toContain(ar.grandfather)
  })

  it('reports every missing part', () => {
    const r = checkNameParts({ first: 'أحمد' })
    expect(r).toEqual({ ok: false, errors: { father: 'required', grandfather: 'required', family: 'required' } })
  })

  it('refuses mixing Arabic and Latin across parts', () => {
    const r = checkNameParts({ ...ar, family: 'Khatib' })
    expect(r).toEqual({ ok: false, errors: { family: 'mixedScripts' } })
  })

  it('refuses one-letter junk in every part', () => {
    const r = checkNameParts({ first: 'a', father: 'b', grandfather: 'c', family: 'd' })
    expect(r.ok).toBe(false)
  })

  it('treats anything that is not an object as empty', () => {
    expect(checkNameParts(null).ok).toBe(false)
    expect(checkNameParts('أحمد محمود صالح الخطيب').ok).toBe(false)
    expect(checkNameParts(['أحمد', 'محمود', 'صالح', 'الخطيب']).ok).toBe(false)
  })

  it('normalizes what it returns', () => {
    const r = checkNameParts({ ...ar, first: '  أحـمد ' })
    expect(r.ok && r.parts.first).toBe('أحمد')
  })
})

describe('fourPartName / shortStudentName', () => {
  it('join the parts in order', () => {
    expect(fourPartName(en)).toBe('Ahmad Mahmoud Saleh Al-Khatib')
    expect(shortStudentName(en)).toBe('Ahmad Al-Khatib')
  })
})
