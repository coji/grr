import { describe, expect, it, vi } from 'vitest'

// Mock dependencies that are imported by character.ts
vi.mock('~/services/db', () => ({
  db: {},
}))
vi.mock('~/services/ai/character-generation', () => ({
  generateCharacterConcept: vi.fn(),
  generateCharacterImage: vi.fn(),
}))
vi.mock('~/services/character-image', () => ({
  addToPool: vi.fn(),
  putBaseImage: vi.fn(),
}))

import {
  characterToConcept,
  getBondLevelDisplay,
  getProgressBar,
  type UserCharacter,
} from './character'

describe('getProgressBar', () => {
  it('should return full bar for 100', () => {
    expect(getProgressBar(100)).toBe('██████████')
  })

  it('should return empty bar for 0', () => {
    expect(getProgressBar(0)).toBe('░░░░░░░░░░')
  })

  it('should return half-filled bar for 50', () => {
    expect(getProgressBar(50)).toBe('█████░░░░░')
  })

  it('should return correct bar for 80', () => {
    expect(getProgressBar(80)).toBe('████████░░')
  })

  it('should return correct bar for 15', () => {
    expect(getProgressBar(15)).toBe('█░░░░░░░░░')
  })
})

describe('getBondLevelDisplay', () => {
  it('should return 1 for bond level 0', () => {
    expect(getBondLevelDisplay(0)).toBe(1)
  })

  it('should return 11 for bond level 100', () => {
    expect(getBondLevelDisplay(100)).toBe(11)
  })

  it('should return 6 for bond level 50', () => {
    expect(getBondLevelDisplay(50)).toBe(6)
  })

  it('should return 3 for bond level 25', () => {
    expect(getBondLevelDisplay(25)).toBe(3)
  })
})

describe('characterToConcept', () => {
  const mockCharacter: UserCharacter = {
    userId: 'U123',
    characterName: 'モカ',
    characterSpecies: 'コーヒー豆の妖精',
    characterEmoji: '☕',
    characterAppearance: '茶色くて丸い体',
    characterPersonality: '穏やかで温かい',
    characterCatchphrase: 'ほっと一息☕',
    evolutionStage: 3,
    evolutionPoints: 150,
    happiness: 80,
    energy: 60,
    bondLevel: 40,
    lastInteractedAt: '2024-01-01T00:00:00Z',
    daysWithoutDiary: 0,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }

  it('should convert character to concept', () => {
    const concept = characterToConcept(mockCharacter)

    expect(concept).toEqual({
      name: 'モカ',
      species: 'コーヒー豆の妖精',
      emoji: '☕',
      appearance: '茶色くて丸い体',
      personality: '穏やかで温かい',
      catchphrase: 'ほっと一息☕',
    })
  })

  it('should handle null appearance with empty string', () => {
    const character = { ...mockCharacter, characterAppearance: null }
    const concept = characterToConcept(character)

    expect(concept.appearance).toBe('')
  })

  it('should handle null personality with empty string', () => {
    const character = { ...mockCharacter, characterPersonality: null }
    const concept = characterToConcept(character)

    expect(concept.personality).toBe('')
  })

  it('should handle null catchphrase with empty string', () => {
    const character = { ...mockCharacter, characterCatchphrase: null }
    const concept = characterToConcept(character)

    expect(concept.catchphrase).toBe('')
  })
})
