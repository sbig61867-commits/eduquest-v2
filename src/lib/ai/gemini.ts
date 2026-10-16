import { GoogleGenerativeAI } from '@google/generative-ai'
import { AI_TIMEOUT_MS } from './timeout'
import { geminiUsage, meterCall } from './meter'

function getModel() {
  const key = process.env.GEMINI_API_KEY
  if (!key || key === 'your_gemini_api_key_here') {
    throw new Error('GEMINI_API_KEY not configured')
  }
  // gemini-2.0-flash was retired by Google (404) — gemini-2.5-flash is the
  // current stable free-tier model, verified live.
  return new GoogleGenerativeAI(key).getGenerativeModel(
    { model: 'gemini-2.5-flash' },
    { timeout: AI_TIMEOUT_MS }
  )
}

export async function generateLessonContent(
  topic: string,
  level: string,
  customInstructions?: string
): Promise<string> {
  const model = getModel()

  const structureBlock = customInstructions?.trim()
    ? `The teacher has provided specific instructions for how to structure this content, follow them exactly:
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

  const prompt = `Create a comprehensive educational lesson about "${topic}" for ${level} level students.

${structureBlock}

Format the response in Markdown.`
  // Not called anywhere. The prompt carries the teacher's free-text
  // instructions, so it is institutional content: meterCall() refuses it
  // before any request unless Gemini is approved for it (privacy.ts).
  return meterCall('gemini', 'gemini-2.5-flash', prompt.length, ['institution'], async () => {
    const result = await model.generateContent(prompt)
    const text = result.response.text()
    return { value: text, ...geminiUsage(result.response), outputChars: text.length }
  })
}
