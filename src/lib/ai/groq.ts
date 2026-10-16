import { aiTimeoutSignal, isAbortError } from './timeout'
import { AiProviderError, meterCall } from './meter'
import type { AiAudience } from './privacy'

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions'

/**
 * Direct Groq call. `audiences` is required: the kinds of content in the prompt
 * (privacy.ts). meterCall() refuses the call before any network I/O unless Groq
 * is approved for every audience listed. There is no default.
 */
export async function groqChat(
  prompt: string,
  systemPrompt: string | undefined,
  temperature: number,
  audiences: readonly AiAudience[],
  opts: { timeoutMs?: number } = {},
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY
  if (!apiKey || apiKey === 'your_groq_api_key_here') {
    throw new Error('GROQ_API_KEY not configured')
  }

  // gpt-oss-120b is free-tier and verified live (llama-3.3-70b-versatile was
  // retired from Groq's catalog, 404 model_not_found). Metered: tokens come
  // from Groq's `usage` block — see meter.ts.
  const model = 'openai/gpt-oss-120b'
  return meterCall('groq', model, prompt.length + (systemPrompt?.length ?? 0), audiences, async () => {
    let res: Response
    try {
      res = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
            { role: 'user', content: prompt },
          ],
          temperature,
          max_tokens: 4096,
        }),
        // Prevents a hung Groq request from holding the invocation open for
        // the full serverless function timeout. No retry on timeout — the
        // caller's own error handling decides what to do (e.g. fall back to
        // another provider), so a timeout can never turn into a retry storm.
        signal: aiTimeoutSignal(opts.timeoutMs),
      })
    } catch (err) {
      if (isAbortError(err)) throw new Error('Groq API error: request timed out')
      // A network error is reported as a code, like every other provider failure.
      throw new AiProviderError('groq', 'network')
    }

    if (!res.ok) {
      // The body can echo the prompt: discard it, keep the status only.
      await res.body?.cancel().catch(() => {})
      throw new AiProviderError('groq', String(res.status))
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new AiProviderError('groq', 'empty')
    return {
      value: content as string,
      inputTokens: data.usage?.prompt_tokens,
      outputTokens: data.usage?.completion_tokens,
      outputChars: content.length,
    }
  })
}

export async function generateLessonContentGroq(
  topic: string,
  level: string,
  customInstructions?: string
): Promise<string> {
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

  // Not called anywhere. The prompt carries the teacher's free-text
  // instructions, so it is institutional content (privacy.ts).
  return groqChat(
    `Create a comprehensive educational lesson about "${topic}" for ${level} level students.

${structureBlock}

Format the response in Markdown.`,
    undefined,
    0.7,
    ['institution'],
  )
}

