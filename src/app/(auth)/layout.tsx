import { LocaleSwitcher } from '@/components/shared/locale-switcher'

// Signed-out pages have no header, so without this a visitor on sign-in,
// join, or password recovery had no way to change language at all.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <LocaleSwitcher className="fixed top-4 end-4 z-50" />
      {children}
    </>
  )
}
