// Makes any picture the author picks uploadable without changing how it looks.
// The upload route caps files at 4 MB, so a phone photo or a large designed
// poster used to be refused outright. The image is re-encoded on the author's
// own device, never cropped or stretched: both sides are scaled by the same
// factor (only when the long side exceeds MAX_SIDE), so the aspect ratio is
// exactly preserved. Small files and animated GIFs are sent untouched.

const LIMIT = 3.8 * 1024 * 1024 // just under the server's 4 MB cap
const MAX_SIDE = 2560
const ALREADY_OK = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

export class ImagePrepError extends Error {
  constructor(public code: 'unreadable' | 'tooLarge') { super(code) }
}

function load(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new ImagePrepError('unreadable')) }
    img.src = url
  })
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, type, quality))
}

export async function prepareImageForUpload(file: File): Promise<File> {
  // Fits already: keep the author's original bytes (the display scales it
  // down without distortion, whatever its dimensions).
  if (ALREADY_OK.has(file.type) && file.size <= LIMIT) return file
  // An animated GIF would lose its animation on a canvas; better to refuse.
  if (file.type === 'image/gif') throw new ImagePrepError('tooLarge')

  const img = await load(file)
  let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  // WebP keeps transparency; JPEG is the fallback where WebP can't be encoded.
  for (let attempt = 0; attempt < 6; attempt++) {
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new ImagePrepError('unreadable')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const quality = attempt < 3 ? 0.9 - attempt * 0.1 : 0.72
    let blob = await encode(canvas, 'image/webp', quality)
    if (!blob || blob.type !== 'image/webp') blob = await encode(canvas, 'image/jpeg', quality)
    if (blob && blob.size <= LIMIT) {
      const ext = blob.type === 'image/webp' ? 'webp' : 'jpg'
      return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || 'image'}.${ext}`, { type: blob.type })
    }
    if (attempt >= 2) scale *= 0.8
  }
  throw new ImagePrepError('tooLarge')
}
