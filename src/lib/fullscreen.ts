/**
 * Full screen for a proctored exam is best-effort, never a gate. iPhone Safari
 * has no element full screen at all, and Chrome refuses the request once the
 * tap that started the exam was spent on the camera/microphone permission
 * prompt (the user gesture has expired by then). Either way the exam must
 * still start, and it must never be reported as a camera failure: that is what
 * blocked students with "camera and microphone permission is required" right
 * after they had granted both.
 */
export function canRequestFullscreen(): boolean {
  return typeof document !== 'undefined' && typeof document.documentElement.requestFullscreen === 'function'
}

/** Enters full screen if possible. Resolves false instead of throwing. */
export async function enterFullscreen(): Promise<boolean> {
  if (typeof document === 'undefined') return false
  if (document.fullscreenElement) return true
  if (!canRequestFullscreen()) return false
  try {
    await document.documentElement.requestFullscreen()
    return true
  } catch {
    return false
  }
}
