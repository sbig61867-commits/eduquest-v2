// Shape of the per-language AI prompt text (src/content/ai/{ar,en}.ts).
//
// A prompt is written in the viewer's language so the model answers in it.
// Each language lives in its own file; both must satisfy this type, so a
// prompt added to one language and forgotten in the other is a type error.

export interface CourseGroupFacts {
  name: string
  teacher: string
  students: number
  progress: string
  active: string
  attendance: string
  sessions: number
}

export interface CourseFacts {
  title: string
  teacher: string
  days: number
  items: number
  enrollments: number
  progress: string
  active: number
  completed: number
}

export interface AiPromptText {
  announcementCopy: {
    system: string
    brief: (brief: string) => string
  }
  courseSuggestions: {
    system: (maxSuggestions: number) => string
    /** Stand-in for a missing teacher name. */
    none: string
    noGroups: string
    groupLine: (g: CourseGroupFacts) => string
    /** Header lines of the fact sheet, before the group list. */
    header: (c: CourseFacts) => string[]
    groupsHeading: string
    notesHeading: string
  }
}
