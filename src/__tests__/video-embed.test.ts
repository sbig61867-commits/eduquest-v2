import { describe, it, expect } from 'vitest'
import { parseVideoUrl } from '@/lib/video-embed'

describe('parseVideoUrl — the only links a course video item may render', () => {
  it('reads every YouTube link shape and embeds the no-cookie player', () => {
    const want = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0'
    for (const link of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      '  https://youtu.be/dQw4w9WgXcQ?si=abc  ',
    ]) {
      expect(parseVideoUrl(link)).toEqual({ kind: 'youtube', id: 'dQw4w9WgXcQ', embedUrl: want })
    }
  })

  it('reads Vimeo links', () => {
    expect(parseVideoUrl('https://vimeo.com/76979871')).toMatchObject({ kind: 'vimeo', embedUrl: 'https://player.vimeo.com/video/76979871' })
    expect(parseVideoUrl('https://player.vimeo.com/video/76979871')).toMatchObject({ kind: 'vimeo', id: '76979871' })
  })

  it('accepts a direct https video file', () => {
    expect(parseVideoUrl('https://cdn.example.org/lesson-1.mp4')).toEqual({ kind: 'file', url: 'https://cdn.example.org/lesson-1.mp4' })
  })

  it('rejects anything that is not a recognised https video', () => {
    for (const link of [
      '', null, undefined, 'not a url',
      'http://youtu.be/dQw4w9WgXcQ',               // not https
      'javascript:alert(1)',
      'https://youtu.be/short',                    // malformed id
      'https://www.youtube.com/watch?v=<script>',
      'https://evil.example/watch?v=dQw4w9WgXcQ',  // lookalike path, wrong host
      'https://vimeo.com/channels/staffpicks',     // no video id
      'https://example.org/page.html',
    ]) {
      expect(parseVideoUrl(link)).toBeNull()
    }
  })
})
