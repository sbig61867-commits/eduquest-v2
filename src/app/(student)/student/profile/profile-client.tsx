'use client'

import { useTranslations, useLocale } from 'next-intl'
import type { Locale } from '@/i18n/config'
import { User, Building2, Users, GraduationCap, School, Lock } from 'lucide-react'
import type { StudentTrack } from '@/lib/student-track'
import { formatDate } from '@/lib/utils'

interface Profile {
  id: string
  full_name: string
  email: string
  member_code?: string
  role: string
  is_active: boolean
  created_at: string
  tenants: { name: string; slug: string } | null
}

interface Group {
  id: string
  name: string
  description: string | null
  teacher: { full_name: string } | null
}

export interface Affiliation {
  track: StudentTrack
  unitL1Label: string
  unitL2Label: string
  /** Faculty › department pairs from the student's groups (institution track + academic mode only) */
  units: { l1: string; l2: string | null }[]
}

interface Props {
  profile: Profile | null
  /** The student's own four-part name (only they can read it); null for older accounts. */
  fourPartName?: string | null
  groups: Group[]
  affiliation?: Affiliation
}

export function StudentProfileClient({ profile, fourPartName = null, groups, affiliation }: Props) {
  const t = useTranslations('student.profile')
  const locale = useLocale() as Locale

  if (!profile) return <div className="text-slate-400">{t('notFound')}</div>
  const ownName = fourPartName ?? profile.full_name

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-bold shrink-0">
          {ownName[0]?.toUpperCase()}
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{ownName}</h2>
          <p className="text-slate-400 text-sm">{profile.email}</p>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
          <Building2 className="w-5 h-5 text-slate-400" />
          <div>
            <p className="text-xs text-slate-500">{t('institution')}</p>
            <p className="text-white text-sm font-medium">{profile.tenants?.name ?? '—'}</p>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
          <User className="w-5 h-5 text-slate-400" />
          <div>
            <p className="text-xs text-slate-500">{t('memberSince')}</p>
            <p className="text-white text-sm font-medium">{formatDate(profile.created_at, locale)}</p>
          </div>
        </div>
      </div>

      {/* Affiliation — centre trainees are never shown faculties/departments */}
      {affiliation?.track === 'centre' && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
          <School className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-300 text-sm font-semibold">{t('centreTrainee')}</p>
            <p className="text-slate-400 text-xs mt-1">
              {t('centreEnrolled', { institution: profile.tenants?.name ?? t('institution') })}
            </p>
          </div>
        </div>
      )}
      {affiliation?.track === 'institution' && affiliation.units.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-start gap-3">
          <GraduationCap className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-xs text-slate-500">{affiliation.unitL1Label} / {affiliation.unitL2Label}</p>
            {affiliation.units.map((u, i) => (
              <p key={i} className="text-white text-sm font-medium">{u.l1}{u.l2 ? ` › ${u.l2}` : ''}</p>
            ))}
          </div>
        </div>
      )}

      {/* Name and email: both fixed. The four-part name is the institution's
          record of the student; only its staff can correct it
          (/api/admin/student-name, users_update pins full_name for students). */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold">{t('details')}</h3>
        <div className="space-y-1.5">
          <label htmlFor="profile-name" className="block text-sm font-medium text-slate-300">{t('fullName')}</label>
          <input
            id="profile-name"
            value={ownName}
            readOnly
            className="w-full px-4 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700 text-white text-sm cursor-default"
          />
          <p className="text-xs text-slate-500 flex items-start gap-1.5">
            <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            {t('nameLocked', { institution: profile.tenants?.name ?? t('institution') })}
          </p>
        </div>
        {profile.member_code && (
          <div className="space-y-1.5">
            <label htmlFor="profile-member-code" className="block text-sm font-medium text-slate-300">{t('memberId')}</label>
            <input
              id="profile-member-code"
              value={profile.member_code}
              readOnly
              dir="ltr"
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700 text-white font-mono text-sm cursor-default"
            />
            <p className="text-xs text-slate-500">{t('memberIdHint')}</p>
          </div>
        )}
        {/* An account created by ID has no email: its email field holds the ID. */}
        {profile.email !== profile.member_code && (
          <div className="space-y-1.5">
            <label htmlFor="profile-email" className="block text-sm font-medium text-slate-300">{t('email')}</label>
            <input
              id="profile-email"
              value={profile.email}
              disabled
              className="w-full px-4 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700 text-slate-400 text-sm cursor-not-allowed"
            />
            <p className="text-xs text-slate-500">{t('emailLocked')}</p>
          </div>
        )}
      </div>

      {/* My Groups */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-400" /> {t('myGroups', { count: groups.length })}
        </h3>
        {groups.length === 0 ? (
          <p className="text-slate-400 text-sm">{t('noGroups')}</p>
        ) : (
          <div className="space-y-2">
            {groups.map(g => (
              <div key={g.id} className="flex items-start gap-3 px-4 py-3 bg-slate-800 rounded-lg">
                <div className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4 text-blue-400" />
                </div>
                <div>
                  <p className="text-white text-sm font-medium">{g.name}</p>
                  <p className="text-slate-400 text-xs">
                    {t('teacher', { name: g.teacher?.full_name ?? '—' })}
                  </p>
                  {g.description && (
                    <p className="text-slate-500 text-xs mt-0.5">{g.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
