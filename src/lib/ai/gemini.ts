import { GoogleGenerativeAI } from '@google/generative-ai'

function getModel() {
  const key = process.env.GEMINI_API_KEY
  if (!key || key === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY not configured')
  }
  return new GoogleGenerativeAI(key).getGenerativeModel({ model: 'gemini-2.0-flash' })
}

export async function generateLessonContent(topic: string, level: string): Promise<string> {
  const model = getModel()
  const result = await model.generateContent(
    `Create a comprehensive educational lesson about "${topic}" for ${level} level students.

Structure the lesson with:
1. Learning Objectives (3-5 bullet points)
2. Introduction
3. Main Content (broken into clear sections)
4. Key Concepts Summary
5. Practice Questions (5 questions)

Format the response in Markdown.`
  )
  return result.response.text()
}
