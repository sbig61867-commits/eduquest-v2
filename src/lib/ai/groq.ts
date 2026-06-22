const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

async function groqChat(prompt: string, systemPrompt?: string): Promise<string> {
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
      model: 'llama-3.3-70b-versatile',
      messages: [
        ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
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

export async function generateLessonContentGroq(topic: string, level: string): Promise<string> {
  return groqChat(
    `Create a comprehensive educational lesson about "${topic}" for ${level} level students.

Structure the lesson with:
1. Learning Objectives (3-5 bullet points)
2. Introduction
3. Main Content (broken into clear sections)
4. Key Concepts Summary
5. Practice Questions (5 questions)

Format the response in Markdown.`
  )
}

export async function generateExamQuestionsGroq(
  topic: string,
  count: number,
  type: 'mcq' | 'true_false' | 'mixed'
): Promise<string> {
  return groqChat(
    `Generate ${count} ${type === 'mixed' ? 'mixed type' : type} exam questions about "${topic}".

Return a JSON array with this structure:
[
  {
    "text": "Question text",
    "type": "mcq" | "true_false" | "short_answer",
    "options": ["A", "B", "C", "D"],
    "correct_answer": "correct answer",
    "points": 10
  }
]

Return ONLY the JSON array, no markdown.`,
    'You are an expert educator. Return only valid JSON.'
  )
}
