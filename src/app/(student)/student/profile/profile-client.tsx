'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { User, Building2, Users, CheckCircle2, GraduationCap, School } from 'lucide-react'
import { CENTRE_TRAINEE_LABEL_AR, type StudentTrack } from '@/lib/student-track'
import { formatDate } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

interface Profile {
  id: string
  full_name: string
  email: string
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
  groups: Group[]
  affiliation?: Affiliation
}

export function StudentProfileClient({ profile, groups, affiliation }: Props) {
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const { setUser } = useAuthStore()
  const supabase = createClient()

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!profile) return
    setLoading(true)
    setError('')
    setSaved(false)

    const { data, error: err } = await supabase
      .from('users')
      .update({ full_name: fullName.trim() })
      .eq('id', profile.id)
      .select('id, full_name, email, role, is_active, tenant_id, avatar_url, can_create_courses, is_university_student, created_at')
      .single()

    if (err) {
      setError(err.message)
    } else {
      setUser(data)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    }
    setLoading(false)
  }

  if (!profile) return <div className="text-slate-400">لم يُعثر على الملف الشخصي.</div>

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-bold shrink-0">
          {profile.full_name[0]?.toUpperCase()}
        </div>
        <div>
          <h2 className="text-2xl font-bold text-white">{profile.full_name}</h2>
          <p className="text-slate-400 text-sm">{profile.email}</p>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
          <Building2 className="w-5 h-5 text-slate-400" />
          <div>
            <p className="text-xs text-slate-500">المؤسسة</p>
            <p className="text-white text-sm font-medium">{profile.tenants?.name ?? '—'}</p>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
          <User className="w-5 h-5 text-slate-400" />
          <div>
            <p className="text-xs text-slate-500">عضو منذ</p>
            <p className="text-white text-sm font-medium">{formatDate(profile.created_at)}</p>
          </div>
        </div>
      </div>

      {/* Affiliation — centre trainees are never shown faculties/departments */}
      {affiliation?.track === 'centre' && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3" dir="rtl">
          <School className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-300 text-sm font-semibold">{CENTRE_TRAINEE_LABEL_AR}</p>
            <p className="text-slate-400 text-xs mt-1">
              مسجّل عن طريق مركز التعليم المستمر في {profile.tenants?.name ?? 'المؤسسة'} — تصلك دورات المركز وإعلاناته.
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

      {/* Edit name */}
      <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold">تعديل الملف الشخصي</h3>

        {error && (
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
        )}
        {saved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> تم تحديث الاسم بنجاح
          </div>
        )}

        <Input
          label="الاسم الكامل"
          value={fullName}
          onChange={e => setFullName(e.target.value)}
          required
          placeholder="اسمك الكامل"
        />
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-300">البريد الإلكتروني</label>
          <input
            value={profile.email}
            disabled
            className="w-full px-4 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700 text-slate-400 text-sm cursor-not-allowed"
          />
          <p className="text-xs text-slate-500">لا يمكن تغيير البريد الإلكتروني</p>
        </div>
        <Button type="submit" loading={loading}>حفظ التغييرات</Button>
      </form>

      {/* My Groups */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-400" /> My Groups ({groups.length})
        </h3>
        {groups.length === 0 ? (
          <p className="text-slate-400 text-sm">لست مسجّلاً في أي مجموعة بعد.</p>
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
                    Teacher: {g.teacher?.full_name ?? '—'}
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
