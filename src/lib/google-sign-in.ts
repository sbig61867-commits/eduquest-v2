// Google sign-in is hidden until Google approves the app's verification
// (owner's decision, 2026-09-29). The code stays in place: set
// NEXT_PUBLIC_GOOGLE_SIGNIN=on (and rebuild — NEXT_PUBLIC_ values are inlined
// at build time) to show the buttons again on /login and /join/<token>.
// Hiding the button does not change /auth/callback, which keeps its
// invitation gate for anyone who still reaches it.
export function googleSignInEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_SIGNIN === 'on'
}
