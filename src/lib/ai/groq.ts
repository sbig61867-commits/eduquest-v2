const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

export async function groqChat(prompt: string, systemPrompt?: string, temperature = 0.7): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey || apiKey === 'your_groq_api_key_here') {
    throw new Error('GROQ_API_KEY not configured')
  }

  const res = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // llama-3.3-70b-versatile was retired from Groq's catalog (404
      // model_not_found) — gpt-oss-120b is free-tier and verified live.
      model: 'openai/gpt-oss-120b',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt },
      ],
      temperature,
      max_tokens: 4096,
    }),
  })

  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Groq API error ${res.status}: ${err}`)
  }

  const data = await res.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('Groq returned no content (empty choices or content filter)')
  return content
}

export async function generateLessonContentGroq(
  topic: string,
  level: string,
  customInstructions?: string
): Promise<string> {
  const structureBlock = customInstructions?.trim()
    ? `The teacher has provided specific instructions for how to structure this content — follow them exactly:
"""
${customInstructions.trim()}
"""
Do not add sections that are not requested. Do not ignore sections that are requested.`
    : `Structure the lesson with:
1. Learning Objectives (3-5 bullet points)
2. Introduction
3. Main Content (broken into clear sections)
4. Key Concepts Summary
5. Practice Questions (5 questions)`

  return groqChat(
    `Create a comprehensive educational lesson about "${topic}" for ${level} level students.

${structureBlock}

Format the response in Markdown.`
  )
}

