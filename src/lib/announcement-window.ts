// Single definition of "is this announcement showing right now", used by
// staff views. Students never use this — get_student_announcements() applies
// the same rule in SQL server-side.
export function isAnnouncementLive(
  a: { is_published: boolean; starts_at: string | null; ends_at: string | null },
  now = Date.now(),
): boolean {
  if (!a.is_published) return false
  if (a.starts_at && new Date(a.starts_at).getTime() > now) return false
  if (a.ends_at && new Date(a.ends_at).getTime() < now) return false
  return true
}
