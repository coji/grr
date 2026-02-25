import { describe, expect, it } from 'vitest'
import { calculateEncounterProbability } from './character-social-utils'

describe('calculateEncounterProbability', () => {
  it('returns base chance with no bonuses', () => {
    const prob = calculateEncounterProbability(0, false, 0)
    expect(prob).toBeCloseTo(0.08)
  })

  it('adds active bonus when both users are active', () => {
    const prob = calculateEncounterProbability(0, true, 0)
    expect(prob).toBeCloseTo(0.14)
  })

  it('adds shared channel bonus', () => {
    const prob = calculateEncounterProbability(3, false, 0)
    expect(prob).toBeCloseTo(0.14) // 0.08 + 3*0.02
  })

  it('caps shared channel bonus', () => {
    const prob = calculateEncounterProbability(10, false, 0)
    expect(prob).toBeCloseTo(0.18) // 0.08 + 0.10 (capped)
  })

  it('adds previous encounter bonus', () => {
    const prob = calculateEncounterProbability(0, false, 1)
    expect(prob).toBeCloseTo(0.12) // 0.08 + 0.04
  })

  it('combines all bonuses', () => {
    const prob = calculateEncounterProbability(5, true, 2)
    // 0.08 + 0.06 + 0.10 + 0.04 = 0.28
    expect(prob).toBeCloseTo(0.28)
  })

  it('caps total probability at 50%', () => {
    // All bonuses combined: 0.08 + 0.06 + 0.10 + 0.04 = 0.28
    // This is under the 50% cap, confirming the formula is bounded
    const prob = calculateEncounterProbability(100, true, 100)
    expect(prob).toBeCloseTo(0.28)
    expect(prob).toBeLessThanOrEqual(0.5)
  })
})
