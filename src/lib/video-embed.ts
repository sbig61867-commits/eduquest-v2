// Course video items store a link the teacher pasted, never an uploaded file,
// so the platform pays nothing to host or stream them. This turns that link
// into something the player can render, and rejects anything else — the
// result is placed in an <iframe src> or <video src>, so only hosts listed
// here (and in next.config's frame-src / media-src) can ever end up there.

export type VideoSource =
  | { kind: 'youtube'; id: string; embedUrl: string }
  | { kind: 'vimeo'; id: string; embedUrl: string }
  | { kind: 'file'; url: string }

const YT_ID = /^[A-Za-z0-9_-]{11}$/
const FILE_EXT = /\.(mp4|webm|ogg|ogv|m4v)$/i

export function parseVideoUrl(raw: string | null | undefined): VideoSource | null {
  const text = (raw ?? '').trim()
  if (!text) return null
  let url: URL
  try { url = new URL(text) } catch { return null }
  if (url.protocol !== 'https:') return null

  const host = url.hostname.replace(/^www\.|^m\./, '')
  const parts = url.pathname.split('/').filter(Boolean)

  if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const id = host === 'youtu.be'
      ? parts[0]
      : parts[0] === 'watch' ? url.searchParams.get('v')
      : ['embed', 'shorts', 'live', 'v'].includes(parts[0]) ? parts[1]
      : null
    if (!id || !YT_ID.test(id)) return null
    // The no-cookie host: no tracking cookies until the student presses play.
    return { kind: 'youtube', id, embedUrl: `https://www.youtube-nocookie.com/embed/${id}?rel=0` }
  }

  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = parts.find(p => /^\d+$/.test(p))
    if (!id) return null
    return { kind: 'vimeo', id, embedUrl: `https://player.vimeo.com/video/${id}` }
  }

  if (FILE_EXT.test(url.pathname)) return { kind: 'file', url: url.toString() }
  return null
}
