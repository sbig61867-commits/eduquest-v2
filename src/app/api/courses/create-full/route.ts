import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'

function adminClient() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface LessonInput {
  title: string
  order: number
}

interface UnitInput {
  name: string
  order: number
  lessons: LessonInput[]
}

interface CourseInput {
  title: string
  description: string
  language: string
  has_levels: boolean
  units: UnitInput[]
}

// POST /api/courses/create-full — create course + units + lessons in one shot
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role, tenant_id, can_create_courses').eq('id', user.id).single()
  if (!profile?.tenant_id || !profile.can_create_courses) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  let body: { course?: CourseInput; source_text?: string }
  try { body = await request.json() }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { course, source_text } = body
  if (!course?.title?.trim()) return NextResponse.json({ error: 'Course title is required' }, { status: 400 })
  if (!Array.isArray(course.units) || course.units.length === 0) {
    return NextResponse.json({ error: 'At least one unit is required' }, { status: 400 })
  }

  const admin = adminClient()

  // 1. Create the course
  const { data: newCourse, error: courseErr } = await admin
    .from('courses')
    .insert({
      title: course.title.trim(),
      description: course.description || null,
      language: course.language || null,
      has_levels: course.has_levels ?? false,
      teacher_id: user.id,
      tenant_id: profile.tenant_id,
      source_text: source_text?.slice(0, 12000) || null,
    })
    .select('id')
    .single()

  if (courseErr || !newCourse) {
    console.error('[create-full] course insert:', courseErr)
    return NextResponse.json({ error: 'Failed to create course' }, { status: 500 })
  }

  // 2. Create units + lessons
  for (const unit of course.units) {
    const { data: newUnit, error: unitErr } = await admin
      .from('course_units')
      .insert({
        course_id: newCourse.id,
        tenant_id: profile.tenant_id,
        level_id: null,
        title: unit.name,
        order_index: unit.order,
      })
      .select('id')
      .single()

    if (unitErr || !newUnit) {
      console.error('[create-full] unit insert:', unitErr)
      continue
    }

    if (Array.isArray(unit.lessons) && unit.lessons.length > 0) {
      // unit_items.type is constrained to ('grammar','idioms','rules','task','quiz','video','text').
      // A generated lesson is a markdown body, so it maps to 'text' (same as the manual
      // "Text / Explanation" item). Using 'lesson' here silently violated the CHECK
      // constraint, so no items were ever created — every unit showed "0 items".
      const itemRows = unit.lessons.map(l => ({
        unit_id: newUnit.id,
        course_id: newCourse.id,
        tenant_id: profile.tenant_id,
        title: l.title,
        type: 'text',
        content: { body: '' },
        order_index: l.order,
      }))

      const { error: itemErr } = await admin.from('unit_items').insert(itemRows)
      if (itemErr) {
        console.error('[create-full] unit_items insert:', itemErr)
        return NextResponse.json(
          { error: `Course created but adding lessons failed: ${itemErr.message}` },
          { status: 500 }
        )
      }
    }
  }

  // 3. Return the created course with counts for the UI
  const { data: finalCourse } = await admin
    .from('courses')
    .select('*, course_levels(count), course_enrollments(count)')
    .eq('id', newCourse.id)
    .single()

  return NextResponse.json(finalCourse, { status: 201 })
}
