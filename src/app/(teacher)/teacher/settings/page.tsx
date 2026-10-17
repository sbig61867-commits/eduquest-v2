import { AccountSettings } from '@/components/shared/account-settings'

// Account settings for this role: my details, change password, language and
// appearance (src/components/shared/account-settings.tsx). The role layout
// already requires a signed-in user.
export default function TeacherSettingsPage() {
  return (
    <div className="max-w-2xl">
      <AccountSettings />
    </div>
  )
}
