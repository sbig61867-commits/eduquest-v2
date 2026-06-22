export type Role = 'super_admin' | 'university_admin' | 'teacher' | 'student'

export interface Tenant {
  id: string
  name: string
  slug: string
  logo_url: string | null
  is_active: boolean
  created_at: string
}

export interface User {
  id: string
  email: string
  full_name: string
  avatar_url: string | null
  role: Role
  tenant_id: string | null
  is_active: boolean
  created_at: string
}

export interface Group {
  id: string
  tenant_id: string
  teacher_id: string
  name: string
  description: string | null
  created_at: string
}

export interface Lesson {
  id: string
  tenant_id: string
  group_id: string
  teacher_id: string
  title: string
  content: string | null
  media_urls: string[]
  is_published: boolean
  created_at: string
}

export interface Exam {
  id: string
  tenant_id: string
  group_id: string
  teacher_id: string
  title: string
  duration_minutes: number
  questions: Question[]
  is_published: boolean
  proctoring_enabled: boolean
  starts_at: string | null
  ends_at: string | null
  created_at: string
}

export interface Question {
  id: string
  text: string
  type: 'mcq' | 'true_false' | 'short_answer'
  options?: string[]
  correct_answer: string
  points: number
}

export interface ExamSubmission {
  id: string
  exam_id: string
  student_id: string
  tenant_id: string
  answers: Record<string, string>
  submitted_at: string
  proctoring_events: ProctoringEvent[]
}

export interface ProctoringEvent {
  type: 'tab_switch' | 'fullscreen_exit' | 'face_not_detected' | 'multiple_faces' | 'audio_detected' | 'looking_away' | 'suspicious_activity'
  timestamp: string
  details?: string
}

export interface Grade {
  id: string
  student_id: string
  exam_id: string
  tenant_id: string
  score: number
  max_score: number
  graded_at: string
}

export interface Invitation {
  id: string
  token: string
  email: string
  role: 'university_admin' | 'teacher' | 'student'
  tenant_id: string
  group_id: string | null
  invited_by: string
  status: 'pending' | 'accepted' | 'revoked'
  expires_at: string
  accepted_at: string | null
  accepted_by: string | null
  created_at: string
  // joined from tenants
  tenants?: { name: string }
  // joined from groups
  groups?: { name: string } | null
  // joined from users (inviter)
  inviter?: { full_name: string; email: string }
}

export interface FeatureFlag {
  id: string
  name: string
  is_enabled: boolean
  tenant_id: string | null
}
