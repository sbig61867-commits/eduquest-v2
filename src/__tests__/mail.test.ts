import { describe, it, expect, beforeAll } from 'vitest'
import { randomBytes } from 'node:crypto'

beforeAll(() => {
  process.env.MAIL_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString('base64')
})

describe('mail token encryption', () => {
  it('round-trips and never stores the plaintext', async () => {
    const { encrypt, decrypt } = await import('@/lib/mail/crypto')
    const secret = '1//refresh-token-example'
    const enc = encrypt(secret)
    expect(enc).not.toContain(secret)
    expect(decrypt(enc)).toBe(secret)
    expect(encrypt(secret)).not.toBe(enc) // random IV
  })

  it('rejects a tampered ciphertext', async () => {
    const { encrypt, decrypt } = await import('@/lib/mail/crypto')
    const [iv, tag, data] = encrypt('x').split('.')
    const flipped = Buffer.from(data, 'base64url'); flipped[0] ^= 1
    expect(() => decrypt([iv, tag, flipped.toString('base64url')].join('.'))).toThrow()
  })
})

describe('OAuth state', () => {
  it('is bound to the user who started the flow', async () => {
    const { signState, verifyState } = await import('@/lib/mail/crypto')
    const state = signState('user-a')
    expect(verifyState(state, 'user-a')).toBe(true)
    expect(verifyState(state, 'user-b')).toBe(false)
    expect(verifyState(state + 'x', 'user-a')).toBe(false)
    expect(verifyState(null, 'user-a')).toBe(false)
  })

  it('expires', async () => {
    const { signState, verifyState } = await import('@/lib/mail/crypto')
    expect(verifyState(signState('user-a', -1), 'user-a')).toBe(false)
  })
})

describe('MIME building', () => {
  it('encodes Arabic headers and blocks header injection', async () => {
    const { buildMime } = await import('@/lib/mail/google')
    const mime = buildMime({
      fromEmail: 'manager@uni.edu', fromName: 'مدير المركز',
      to: 'student@uni.edu\r\nBcc: victim@evil.com',
      subject: 'شهادة الدورة\nBcc: x@y.z', html: '<p>مرحبا</p>',
    })
    const headers = mime.split('\r\n\r\n')[0]
    expect(headers).toContain('=?UTF-8?B?')
    expect(headers.split('\r\n').some(l => l.startsWith('Bcc:'))).toBe(false)
  })

  it('only trusts a verified email from the id_token', async () => {
    const { emailFromIdToken } = await import('@/lib/mail/google')
    const token = (p: object) => `h.${Buffer.from(JSON.stringify(p)).toString('base64url')}.s`
    expect(emailFromIdToken(token({ email: 'a@uni.edu', email_verified: true }))).toBe('a@uni.edu')
    expect(emailFromIdToken(token({ email: 'a@uni.edu', email_verified: false }))).toBeNull()
    expect(emailFromIdToken(undefined)).toBeNull()
  })
})
