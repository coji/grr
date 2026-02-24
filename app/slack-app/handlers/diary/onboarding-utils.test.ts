import { describe, expect, it } from 'vitest'
import { detectReferralPattern } from './onboarding-utils'

describe('detectReferralPattern', () => {
  const BOT_ID = 'UBOT123'
  const SENDER_ID = 'USENDER'

  it('should detect referral when another user is mentioned', () => {
    const text = '<@UBOT123> <@UNEWUSER> に案内して'
    const result = detectReferralPattern(text, SENDER_ID, BOT_ID)

    expect(result.isReferral).toBe(true)
    expect(result.newUserId).toBe('UNEWUSER')
  })

  it('should return first mentioned user when multiple users are mentioned', () => {
    const text = '<@UBOT123> <@UFIRST> と <@USECOND> に案内して'
    const result = detectReferralPattern(text, SENDER_ID, BOT_ID)

    expect(result.isReferral).toBe(true)
    expect(result.newUserId).toBe('UFIRST')
  })

  it('should not detect referral when only bot is mentioned', () => {
    const text = '<@UBOT123> こんにちは'
    const result = detectReferralPattern(text, SENDER_ID, BOT_ID)

    expect(result.isReferral).toBe(false)
    expect(result.newUserId).toBeUndefined()
  })

  it('should not detect referral when sender mentions themselves', () => {
    const text = '<@UBOT123> <@USENDER>'
    const result = detectReferralPattern(text, SENDER_ID, BOT_ID)

    expect(result.isReferral).toBe(false)
    expect(result.newUserId).toBeUndefined()
  })

  it('should exclude bot from referral targets', () => {
    const text = '<@UBOT123> <@UBOT123>'
    const result = detectReferralPattern(text, SENDER_ID, BOT_ID)

    expect(result.isReferral).toBe(false)
  })

  it('should handle text without any mentions', () => {
    const text = 'こんにちは'
    const result = detectReferralPattern(text, SENDER_ID, BOT_ID)

    expect(result.isReferral).toBe(false)
  })

  it('should handle mixed case user IDs', () => {
    const text = '<@UBOT123> <@U12ABC34>'
    const result = detectReferralPattern(text, SENDER_ID, BOT_ID)

    expect(result.isReferral).toBe(true)
    expect(result.newUserId).toBe('U12ABC34')
  })
})
