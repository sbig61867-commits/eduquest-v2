import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { activeHref, breadcrumbFor, NAVIGATION, resolveNav, type NavRole } from '@/lib/navigation'
import en from '@/messages/en'
import ar from '@/messages/ar'

/**
 * D4 central navigation: every entry points at an existing page, every label
 * exists in both languages, exactly one item is active for a path, and the
 * breadcrumb follows the group hierarchy.
 */

const ROUTE_GROUP: Record<NavRole, string> = {
  admin: '(admin)', center: '(center)', teacher: '(teacher)', student: '(student)', superAdmin: '(super-admin)',
}
const APP = join(__dirname, '..', 'app')
const ROLES = Object.keys(NAVIGATION) as NavRole[]

const entries = (role: NavRole) => [NAVIGATION[role].home, ...NAVIGATION[role].groups.flatMap(g => g.items)]

describe('central navigation', () => {
  for (const role of ROLES) {
    it(`${role}: every href is an existing page, listed once`, () => {
      const hrefs = entries(role).map(e => e.href)
      expect(new Set(hrefs).size).toBe(hrefs.length)
      for (const href of hrefs) {
        expect(existsSync(join(APP, ROUTE_GROUP[role], ...href.split('/').filter(Boolean), 'page.tsx')), href).toBe(true)
      }
    })

    it(`${role}: every item and group label exists in en and ar`, () => {
      for (const messages of [en, ar] as unknown as Record<string, Record<string, Record<string, string>>>[]) {
        const ns = messages[role]
        for (const e of entries(role)) expect(ns.nav?.[e.key], `${role}.nav.${e.key}`).toBeTruthy()
        for (const g of NAVIGATION[role].groups) expect(ns.navGroups?.[g.key], `${role}.navGroups.${g.key}`).toBeTruthy()
      }
    })

    it(`${role}: no icon is used twice`, () => {
      const icons = entries(role).map(e => e.icon)
      expect(new Set(icons).size).toBe(icons.length)
    })
  }

  it('group links keep their institution-type term (admin + centre)', () => {
    for (const href of ['/admin/groups', '/center/groups']) {
      expect(Object.values(NAVIGATION).flatMap(r => r.groups.flatMap(g => g.items)).find(e => e.href === href)?.term, href).toBe('groups')
    }
  })

  it('activeHref picks one item: exact or parent segment, never a sibling prefix', () => {
    const hrefs = ['/teacher/dashboard', '/teacher/records', '/teacher/proctoring', '/a/b', '/a/bc']
    expect(activeHref('/teacher/records', hrefs)).toBe('/teacher/records')
    expect(activeHref('/teacher/records/g1/s2', hrefs)).toBe('/teacher/records')
    expect(activeHref('/a/bc', hrefs)).toBe('/a/bc')
    expect(activeHref('/a/bcd', hrefs)).toBeNull()
    expect(activeHref('/teacher/proctoring/live/x', [...hrefs, '/teacher/proctoring/live'])).toBe('/teacher/proctoring/live')
  })

  it('breadcrumb: group (label only) / item, and marks detail pages as deeper', () => {
    const nav = resolveNav('teacher', k => k)
    expect(breadcrumbFor(nav, '/teacher/lessons')).toMatchObject({ group: { label: 'navGroups.teaching' }, item: { label: 'nav.lessons' }, deeper: false })
    expect(breadcrumbFor(nav, '/teacher/lessons/123')).toMatchObject({ item: { href: '/teacher/lessons' }, deeper: true })
    expect(breadcrumbFor(nav, '/teacher/dashboard')).toMatchObject({ group: null, item: { href: '/teacher/dashboard' } })
    expect(breadcrumbFor(nav, '/elsewhere')).toEqual({ group: null, item: null, deeper: false })
  })
})
