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
