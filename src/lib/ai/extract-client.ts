// Client-side companion to /api/ai/extract-file. Sends files ONE AT A TIME
// (each request stays well under Vercel's ~4.5MB serverless body limit even
// when every file is individually small but a batch of many isn't) and
// stitches the results into the same "=== FILE: name ===" format the
// generation routes expect, so multi-file uploads carry only extracted text
// — never the raw files — in the final generation request.

// `t` is the caller's `useTranslations('common.ai')` — this is a plain
// function, not a hook, so the translator is passed in rather than imported.
type Translate = (key: 'extractNetworkError' | 'extractFailed', values: { name: string }) => string

export async function extractFilesText(files: File[], t: Translate): Promise<{ combined: string } | { error: string }> {
  const parts: string[] = []
  for (const f of files) {
    const fd = new FormData()
    fd.append('file', f)
    let data: { text?: string; error?: string }
    try {
      const res = await fetch('/api/ai/extract-file', { method: 'POST', body: fd })
      data = await res.json()
    } catch {
      return { error: t('extractNetworkError', { name: f.name }) }
    }
    if (typeof data.text !== 'string') {
      return { error: data.error ?? t('extractFailed', { name: f.name }) }
    }
    parts.push(files.length > 1 ? `=== FILE: ${f.name} ===\n${data.text}` : data.text)
  }
  return { combined: parts.join('\n\n') }
}
