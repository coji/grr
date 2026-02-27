import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UserMemory } from '~/services/memory'
import {
  CONSOLIDATION_TARGET,
  CONSOLIDATION_THRESHOLD,
  validateConsolidationPlan,
  type ConsolidationPlan,
} from './memory-consolidation'

// Mock genai wrapper
vi.mock('./genai', () => ({
  generateObject: vi.fn(),
}))

function createMockMemory(overrides: Partial<UserMemory> = {}): UserMemory {
  return {
    id: `mem_${Math.random().toString(36).slice(2, 8)}`,
    userId: 'U123',
    memoryType: 'fact',
    category: 'general',
    content: 'テストの記憶',
    sourceEntryIds: null,
    confidence: 1.0,
    importance: 5,
    firstObservedAt: '2025-01-01T00:00:00.000Z',
    lastConfirmedAt: '2025-01-01T00:00:00.000Z',
    mentionCount: 1,
    isActive: 1,
    supersededBy: null,
    userConfirmed: 0,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  }
}

describe('memory-consolidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constants', () => {
    it('CONSOLIDATION_THRESHOLD should be greater than CONSOLIDATION_TARGET', () => {
      expect(CONSOLIDATION_THRESHOLD).toBeGreaterThan(CONSOLIDATION_TARGET)
    })
  })

  describe('validateConsolidationPlan', () => {
    it('should validate a correct plan with all IDs accounted for', () => {
      const memories = [
        createMockMemory({ id: 'a' }),
        createMockMemory({ id: 'b' }),
        createMockMemory({ id: 'c' }),
        createMockMemory({ id: 'd' }),
      ]

      const plan: ConsolidationPlan = {
        keep: ['a'],
        merge: [
          {
            sourceIds: ['b', 'c'],
            content: '統合された記憶',
            memoryType: 'fact',
            category: 'general',
            importance: 5,
          },
        ],
        deactivate: ['d'],
      }

      const result = validateConsolidationPlan(plan, memories)
      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should detect unknown IDs', () => {
      const memories = [createMockMemory({ id: 'a' })]

      const plan: ConsolidationPlan = {
        keep: ['a', 'unknown'],
        merge: [],
        deactivate: [],
      }

      const result = validateConsolidationPlan(plan, memories)
      expect(result.valid).toBe(false)
      expect(result.errors).toContain('keep contains unknown ID: unknown')
    })

    it('should detect duplicate IDs across actions', () => {
      const memories = [
        createMockMemory({ id: 'a' }),
        createMockMemory({ id: 'b' }),
      ]

      const plan: ConsolidationPlan = {
        keep: ['a'],
        merge: [],
        deactivate: ['a', 'b'], // 'a' is in both keep and deactivate
      }

      const result = validateConsolidationPlan(plan, memories)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true)
    })

    it('should detect unassigned memory IDs', () => {
      const memories = [
        createMockMemory({ id: 'a' }),
        createMockMemory({ id: 'b' }),
        createMockMemory({ id: 'c' }),
      ]

      const plan: ConsolidationPlan = {
        keep: ['a'],
        merge: [],
        deactivate: [], // 'b' and 'c' are not assigned
      }

      const result = validateConsolidationPlan(plan, memories)
      expect(result.valid).toBe(false)
      expect(
        result.errors.some((e) => e.includes('Memory b not assigned')),
      ).toBe(true)
      expect(
        result.errors.some((e) => e.includes('Memory c not assigned')),
      ).toBe(true)
    })

    it('should reject merge groups with less than 2 sources', () => {
      const memories = [
        createMockMemory({ id: 'a' }),
        createMockMemory({ id: 'b' }),
      ]

      const plan: ConsolidationPlan = {
        keep: ['b'],
        merge: [
          {
            sourceIds: ['a'],
            content: '不正なマージ',
            memoryType: 'fact',
            category: 'general',
            importance: 5,
          },
        ],
        deactivate: [],
      }

      const result = validateConsolidationPlan(plan, memories)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('at least 2 sources'))).toBe(
        true,
      )
    })

    it('should reject merge groups with empty content', () => {
      const memories = [
        createMockMemory({ id: 'a' }),
        createMockMemory({ id: 'b' }),
      ]

      const plan: ConsolidationPlan = {
        keep: [],
        merge: [
          {
            sourceIds: ['a', 'b'],
            content: '',
            memoryType: 'fact',
            category: 'general',
            importance: 5,
          },
        ],
        deactivate: [],
      }

      const result = validateConsolidationPlan(plan, memories)
      expect(result.valid).toBe(false)
      expect(result.errors.some((e) => e.includes('empty content'))).toBe(true)
    })
  })
})
