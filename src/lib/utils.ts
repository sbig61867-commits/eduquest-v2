import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { Role } from '@/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getRoleDashboardPath(role: Role): string {
  const paths: Record<Role, string> = {
    super_admin: '/super-admin/dashboard',
    university_admin: '/admin/dashboard',
    center_manager: '/center/dashboard',
    teacher: '/teacher/dashboard',
    student: '/student/dashboard',
  }
  return paths[role]
}

export function getRoleLabel(role: Role): string {
  const labels: Record<Role, string> = {
    super_admin: 'Super Admin',
    university_admin: 'University Admin',
    center_manager: 'Centre Manager',
    teacher: 'Teacher',
    student: 'Student',
  }
  return labels[role]
}

export function formatDate(dateString: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(dateString))
}

export function formatDateTime(dateString: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(dateString))
}

/**
 * Stops one failed Supabase query from taking a whole page down.
 *
 * Server components across the app fan out with `Promise.all([...])` and then
 * destructure `{ data }` / `{ count }` straight out of the result. `Promise.all`
 * rejects the moment any one query rejects — a cold start or a network blip
 * against Supabase then throws out of the server component and the user gets the
 * error boundary instead of the page, even when every other query succeeded.
 *
 * Wrapping a query in `settle()` makes it resolve with an empty result and log
 * the reason instead of rejecting, so the existing `?? []` and `?? 0` fallbacks
 * downstream do their job and the page renders with the parts that did load.
 */
export async function settle<T extends { data?: unknown; count?: number | null; error?: unknown }>(
  query: PromiseLike<T>,
  label: string
): Promise<T> {
  try {
    const result = await query
    if (result?.error) console.error(`[settle:${label}]`, result.error)
    return result
  } catch (cause) {
    console.error(`[settle:${label}] threw`, cause)
    return { data: null, count: null, error: cause } as unknown as T
  }
}
