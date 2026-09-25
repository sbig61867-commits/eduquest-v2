import { redirect } from 'next/navigation'

// The grades overview became the per-group student records section; old links land there.
export default function TeacherGradesPage() {
  redirect('/teacher/records')
}
