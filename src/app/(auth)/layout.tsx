// Signed-out pages (sign-in, recovery, invitation) each render AuthTopBar
// (src/components/public/auth-top-bar.tsx), which carries the language and
// appearance switches, so this layout adds nothing of its own.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children
}
