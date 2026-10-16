import { describe, expect, it } from 'vitest'

import { firstName } from '@/lib/first-name'

describe('firstName', () => {
  it('takes the first word of a full name', () => {
    expect(firstName('محمد احمد خليل محمود')).toBe('محمد')
    expect(firstName('Sara Ahmad')).toBe('Sara')
  })

  it('keeps Arabic compound first names whole', () => {
    expect(firstName('عبد الله أحمد')).toBe('عبد الله')
    expect(firstName('عبد الرحمن محمد علي')).toBe('عبد الرحمن')
    expect(firstName('أبو بكر سالم')).toBe('أبو بكر')
    expect(firstName('ابو عمر خالد')).toBe('ابو عمر')
    expect(firstName('عبدالله أحمد')).toBe('عبدالله')
  })

  it('keeps Latin spellings of compound names whole', () => {
    expect(firstName('Abd Allah Omar')).toBe('Abd Allah')
    expect(firstName('Abdul Rahman Ali')).toBe('Abdul Rahman')
    expect(firstName('abu Bakr')).toBe('abu Bakr')
  })

  it('does not join when the prefix is the only word', () => {
    expect(firstName('عبد')).toBe('عبد')
  })

  it('ignores extra spaces', () => {
    expect(firstName('   محمد    احمد ')).toBe('محمد')
  })

  it('returns null when there is no name', () => {
    expect(firstName('')).toBeNull()
    expect(firstName('   ')).toBeNull()
    expect(firstName(null)).toBeNull()
    expect(firstName(undefined)).toBeNull()
  })
})
