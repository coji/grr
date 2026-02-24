import type { SectionBlock } from 'slack-cloudflare-workers'
import { describe, expect, it } from 'vitest'
import {
  buildCharacterIntroMessage,
  buildReferralWelcomeMessage,
  buildWelcomeMessage,
} from './welcome'

describe('buildWelcomeMessage', () => {
  it('should include user name when provided', () => {
    const result = buildWelcomeMessage('田中')
    const firstBlock = result.blocks[0] as SectionBlock

    expect(result.text).toContain('田中さん')
    expect(firstBlock.text?.text).toContain('田中さん')
  })

  it('should work without user name', () => {
    const result = buildWelcomeMessage()

    expect(result.text).toContain('はじめまして')
    expect(result.text).not.toContain('さん、はじめまして')
  })

  it('should include persona name', () => {
    const result = buildWelcomeMessage('田中')

    expect(result.text).toContain('ほたる')
  })

  it('should have correct block structure', () => {
    const result = buildWelcomeMessage('田中')

    expect(result.blocks).toHaveLength(3)
    expect(result.blocks[0].type).toBe('section')
    expect(result.blocks[1].type).toBe('section')
    expect(result.blocks[2].type).toBe('section')
  })
})

describe('buildReferralWelcomeMessage', () => {
  it('should include both user names', () => {
    const result = buildReferralWelcomeMessage('田中', '山田')

    expect(result.text).toContain('田中さん')
    expect(result.text).toContain('山田さん')
  })

  it('should mention referral', () => {
    const result = buildReferralWelcomeMessage('田中', '山田')
    const firstBlock = result.blocks[0] as SectionBlock

    expect(firstBlock.text?.text).toContain('紹介')
  })

  it('should include persona name', () => {
    const result = buildReferralWelcomeMessage('田中', '山田')
    const secondBlock = result.blocks[1] as SectionBlock

    expect(secondBlock.text?.text).toContain('ほたる')
  })

  it('should have correct block structure', () => {
    const result = buildReferralWelcomeMessage('田中', '山田')

    expect(result.blocks).toHaveLength(3)
  })
})

describe('buildCharacterIntroMessage', () => {
  it('should include character details', () => {
    const result = buildCharacterIntroMessage('ぽぽ', '☕', 'コーヒー豆の妖精')
    const firstBlock = result.blocks[0] as SectionBlock

    expect(result.text).toContain('ぽぽ')
    expect(firstBlock.text?.text).toContain('☕')
    expect(firstBlock.text?.text).toContain('コーヒー豆の妖精')
  })

  it('should mention growth', () => {
    const result = buildCharacterIntroMessage('ぽぽ', '☕', 'コーヒー豆の妖精')
    const firstBlock = result.blocks[0] as SectionBlock

    expect(firstBlock.text?.text).toContain('成長')
  })
})
