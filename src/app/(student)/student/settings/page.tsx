import { AccountSettings } from '@/components/shared/account-settings'

// The student's account settings: my details, change password, language and
// appearance — the same section every role has. /student/profile keeps the
// student-specific view (groups, affiliation). The layout requires a session.
export default function StudentSettingsPage() {
  return (
    <div className="max-w-2xl">
      <AccountSettings />
    </div>
  )
}
