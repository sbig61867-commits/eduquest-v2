'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { User, Building2, Users, CheckCircle2 } from 'lucide-react'
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

interface Props {
  profile: Profile | null
  groups: Group[]
}

export function StudentProfileClient({ profile, groups }: Props) {
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
      .select('*, tenants(*)')
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

  if (!profile) return <div className="text-slate-400">Profile not found.</div>

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
            <p className="text-xs text-slate-500">Institution</p>
            <p className="text-white text-sm font-medium">{profile.tenants?.name ?? '—'}</p>
          </div>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex items-center gap-3">
          <User className="w-5 h-5 text-slate-400" />
          <div>
            <p className="text-xs text-slate-500">Member since</p>
            <p className="text-white text-sm font-medium">{formatDate(profile.created_at)}</p>
          </div>
        </div>
      </div>

      {/* Edit name */}
      <form onSubmit={handleSave} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold">Edit Profile</h3>

        {error && (
          <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
        )}
        {saved && (
          <div className="flex items-center gap-2 text-emerald-400 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
            <CheckCircle2 className="w-4 h-4" /> Name updated successfully
          </div>
        )}

        <Input
          label="Full Name"
          value={fullName}
          onChange={e => setFullName(e.target.value)}
          required
          placeholder="Your full name"
        />
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-slate-300">Email</label>
          <input
            value={profile.email}
            disabled
            className="w-full px-4 py-2.5 rounded-lg bg-slate-800/50 border border-slate-700 text-slate-400 text-sm cursor-not-allowed"
          />
          <p className="text-xs text-slate-500">Email cannot be changed</p>
        </div>
        <Button type="submit" loading={loading}>Save Changes</Button>
      </form>

      {/* My Groups */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
        <h3 className="text-white font-semibold flex items-center gap-2">
          <Users className="w-4 h-4 text-slate-400" /> My Groups ({groups.length})
        </h3>
        {groups.length === 0 ? (
          <p className="text-slate-400 text-sm">You are not enrolled in any group yet.</p>
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
