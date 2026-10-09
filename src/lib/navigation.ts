import type { Terms } from '@/lib/terminology'

/**
 * Central navigation per role (D4, 2026-10-06). One source for the sidebar
 * groups and the header breadcrumb: `role / group / page`. Groups are labels,
 * not pages — they never link anywhere. Labels are message keys resolved in
 * each role layout (`nav.<key>`, `navGroups.<key>` in that role's namespace),
 * so nothing here is language-specific. URLs and routing are unchanged.
 */

export type IconName =
  | 'LayoutDashboard' | 'Building2' | 'Users' | 'Settings' | 'Flag' | 'ShieldCheck'
  | 'GraduationCap' | 'BookOpen' | 'ClipboardList' | 'ClipboardCheck' | 'Activity'
  | 'BarChart2' | 'Bell' | 'Mail' | 'Layers' | 'Inbox' | 'Archive' | 'CalendarDays'
  | 'Gavel' | 'Network' | 'Sparkles' | 'FileText' | 'Megaphone' | 'UserCog' | 'ScanEye'
  | 'ScrollText' | 'CircleUser'

export interface NavEntry {
  key: string
  href: string
  icon: IconName
  /** Label follows the tenant's institution type (terminology.ts). */
  term?: keyof Terms
  /** Hidden unless the tenant uses the academic structure. */
  academicOnly?: boolean
  /** Hidden for institutions without a continuing-education centre. */
  centerOnly?: boolean
}

export interface NavGroupDef {
  key: string
  items: NavEntry[]
}

export interface RoleNavDef {
  home: NavEntry
  groups: NavGroupDef[]
}

export type NavRole = 'admin' | 'center' | 'teacher' | 'student' | 'superAdmin'

const home = (prefix: string): NavEntry => ({ key: 'dashboard', href: `/${prefix}/dashboard`, icon: 'LayoutDashboard' })

export const NAVIGATION: Record<NavRole, RoleNavDef> = {
  admin: {
    home: home('admin'),
    groups: [
      { key: 'people', items: [
        { key: 'teachers', href: '/admin/teachers', icon: 'GraduationCap' },
        { key: 'students', href: '/admin/students', icon: 'Users' },
        { key: 'centerStaff', href: '/admin/center-staff', icon: 'UserCog', centerOnly: true },
        { key: 'invitations', href: '/admin/invitations', icon: 'Mail' },
      ] },
      { key: 'academic', items: [
        { key: 'academic', href: '/admin/academic', icon: 'Network', academicOnly: true },
        { key: 'groups', href: '/admin/groups', icon: 'Layers', term: 'groups' },
        { key: 'courses', href: '/admin/courses', icon: 'BookOpen' },
        { key: 'schedules', href: '/admin/schedules', icon: 'CalendarDays' },
      ] },
      { key: 'content', items: [
        { key: 'lessons', href: '/admin/lessons', icon: 'FileText' },
        { key: 'exams', href: '/admin/exams', icon: 'ClipboardList' },
        { key: 'appeals', href: '/admin/appeals', icon: 'Gavel' },
      ] },
      { key: 'communication', items: [
        { key: 'requests', href: '/admin/requests', icon: 'Inbox' },
        { key: 'announcements', href: '/admin/announcements', icon: 'Megaphone' },
      ] },
      { key: 'institution', items: [
        { key: 'archive', href: '/admin/archive', icon: 'Archive' },
        { key: 'settings', href: '/admin/settings', icon: 'Settings' },
      ] },
    ],
  },
  center: {
    home: home('center'),
    groups: [
      { key: 'people', items: [
        { key: 'teachers', href: '/center/teachers', icon: 'GraduationCap' },
        { key: 'students', href: '/center/students', icon: 'Users' },
      ] },
      { key: 'programs', items: [
        { key: 'groups', href: '/center/groups', icon: 'Layers', term: 'groups' },
        { key: 'courses', href: '/center/courses', icon: 'BookOpen' },
        { key: 'schedules', href: '/center/schedules', icon: 'CalendarDays' },
      ] },
      { key: 'tracking', items: [
        { key: 'attendance', href: '/center/attendance', icon: 'ClipboardCheck' },
        { key: 'analytics', href: '/center/analytics', icon: 'BarChart2' },
      ] },
      { key: 'communication', items: [
        { key: 'announcements', href: '/center/announcements', icon: 'Megaphone' },
        { key: 'mail', href: '/center/mail', icon: 'Mail' },
      ] },
    ],
  },
  teacher: {
    home: home('teacher'),
    groups: [
      { key: 'teaching', items: [
        { key: 'groups', href: '/teacher/groups', icon: 'Layers' },
        { key: 'courses', href: '/teacher/courses', icon: 'BookOpen' },
        { key: 'lessons', href: '/teacher/lessons', icon: 'FileText' },
        { key: 'schedule', href: '/teacher/schedule', icon: 'CalendarDays' },
      ] },
      { key: 'assessment', items: [
        { key: 'exams', href: '/teacher/exams', icon: 'ClipboardList' },
        { key: 'proctoring', href: '/teacher/proctoring', icon: 'ScanEye' },
      ] },
      { key: 'students', items: [
        { key: 'records', href: '/teacher/records', icon: 'BarChart2' },
        { key: 'attendance', href: '/teacher/attendance', icon: 'ClipboardCheck' },
        { key: 'engagement', href: '/teacher/engagement', icon: 'Activity' },
        { key: 'invitations', href: '/teacher/invitations', icon: 'Mail' },
      ] },
      { key: 'communication', items: [
        { key: 'requests', href: '/teacher/requests', icon: 'Inbox' },
      ] },
    ],
  },
  student: {
    home: home('student'),
    groups: [
      { key: 'learning', items: [
        { key: 'courses', href: '/student/courses', icon: 'BookOpen' },
        { key: 'lessons', href: '/student/lessons', icon: 'FileText' },
        { key: 'exams', href: '/student/exams', icon: 'ClipboardList' },
      ] },
      { key: 'tracking', items: [
        { key: 'grades', href: '/student/grades', icon: 'BarChart2' },
        { key: 'attendance', href: '/student/attendance', icon: 'ClipboardCheck' },
        { key: 'schedule', href: '/student/schedule', icon: 'CalendarDays' },
      ] },
      { key: 'account', items: [
        { key: 'notifications', href: '/student/notifications', icon: 'Bell' },
        { key: 'profile', href: '/student/profile', icon: 'CircleUser' },
      ] },
    ],
  },
  superAdmin: {
    home: home('super-admin'),
    groups: [
      { key: 'institutions', items: [
        { key: 'tenants', href: '/super-admin/tenants', icon: 'Building2' },
        { key: 'users', href: '/super-admin/users', icon: 'Users' },
        { key: 'invitations', href: '/super-admin/invitations', icon: 'Mail' },
      ] },
      { key: 'governance', items: [
        { key: 'permissions', href: '/super-admin/permissions', icon: 'ShieldCheck' },
        { key: 'audit', href: '/super-admin/audit', icon: 'ScrollText' },
        { key: 'features', href: '/super-admin/features', icon: 'Flag' },
      ] },
      { key: 'operations', items: [
        { key: 'reports', href: '/super-admin/reports', icon: 'BarChart2' },
        { key: 'aiUsage', href: '/super-admin/ai-usage', icon: 'Sparkles' },
        { key: 'messages', href: '/super-admin/messages', icon: 'Inbox' },
      ] },
      { key: 'platform', items: [
        { key: 'settings', href: '/super-admin/settings', icon: 'Settings' },
      ] },
    ],
  },
}

/** A NavEntry with its label resolved — what the client shell receives. */
export interface NavItem extends Omit<NavEntry, 'key'> {
  label: string
}

export interface NavGroup {
  key: string
  label: string
  items: NavItem[]
}

export interface ResolvedNav {
  home: NavItem
  groups: NavGroup[]
}

type Translate = (key: string) => string

/** Resolves labels with the role namespace's translator (server layouts). */
export function resolveNav(role: NavRole, t: Translate): ResolvedNav {
  const def = NAVIGATION[role]
  const item = ({ key, ...rest }: NavEntry): NavItem => ({ ...rest, label: t(`nav.${key}`) })
  return {
    home: item(def.home),
    groups: def.groups.map(g => ({ key: g.key, label: t(`navGroups.${g.key}`), items: g.items.map(item) })),
  }
}

/**
 * The single active item for a path: the longest href that equals the path or
 * is a parent segment of it. `/a/b` never activates `/a/bc`, and two items
 * can never be active at once.
 */
export function activeHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null
  for (const href of hrefs) {
    if ((pathname === href || pathname.startsWith(href + '/')) && (!best || href.length > best.length)) best = href
  }
  return best
}

/** Breadcrumb trail for a path: the group (label only) and the matched item. */
export function breadcrumbFor(nav: ResolvedNav, pathname: string): { group: NavGroup | null; item: NavItem | null; deeper: boolean } {
  const all = [nav.home, ...nav.groups.flatMap(g => g.items)]
  const href = activeHref(pathname, all.map(i => i.href))
  if (!href) return { group: null, item: null, deeper: false }
  const item = all.find(i => i.href === href) ?? null
  const group = nav.groups.find(g => g.items.some(i => i.href === href)) ?? null
  return { group, item, deeper: pathname !== href }
}
