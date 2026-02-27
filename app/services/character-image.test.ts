import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockR2Get, mockR2Put, mockR2List, mockKvGet, mockKvPut } = vi.hoisted(
  () => ({
    mockR2Get: vi.fn(),
    mockR2Put: vi.fn(),
    mockR2List: vi.fn(),
    mockKvGet: vi.fn(),
    mockKvPut: vi.fn(),
  }),
)

vi.mock('cloudflare:workers', () => ({
  env: {
    CHARACTER_IMAGES: {
      get: mockR2Get,
      put: mockR2Put,
      list: mockR2List,
    },
    KV: {
      get: mockKvGet,
      put: mockKvPut,
    },
  },
}))

vi.mock('nanoid', () => ({
  nanoid: () => 'abc12345',
}))

import {
  addToPool,
  buildBaseKey,
  DAILY_GENERATION_CAP,
  extractImageId,
  getPoolImageById,
  getRandomPoolImage,
  pickRandomPoolKey,
  POOL_ACTIVE_DAYS,
} from './character-image'

describe('buildBaseKey', () => {
  it('should build correct R2 key', () => {
    expect(buildBaseKey('U123')).toBe('character/U123/base.png')
  })
})

describe('addToPool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should store image with stage-prefixed key', async () => {
    const pngData = new ArrayBuffer(8)
    const key = await addToPool('U123', 3, pngData)

    expect(key).toMatch(
      /^character\/U123\/pool\/stage3\/\d{4}-\d{2}-\d{2}-abc12345\.png$/,
    )
    expect(mockR2Put).toHaveBeenCalledWith(key, pngData, {
      httpMetadata: { contentType: 'image/png' },
    })
  })
})

describe('getRandomPoolImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when pool is empty', async () => {
    mockR2List.mockResolvedValue({ objects: [] })

    const result = await getRandomPoolImage('U123', 1)
    expect(result).toBeNull()
  })

  it('should return image from pool', async () => {
    const imageData = new ArrayBuffer(16)
    mockR2List.mockResolvedValue({
      objects: [{ key: 'character/U123/pool/stage1/2026-02-24-abc12345.png' }],
    })
    mockR2Get.mockResolvedValue({
      arrayBuffer: () => Promise.resolve(imageData),
    })
    mockKvGet.mockResolvedValue(null)
    mockKvPut.mockResolvedValue(undefined)

    const result = await getRandomPoolImage('U123', 1)
    expect(result).toBe(imageData)
  })

  it('should avoid repeating the last served image', async () => {
    const key1 = 'character/U123/pool/stage1/2026-02-24-aaa.png'
    const key2 = 'character/U123/pool/stage1/2026-02-24-bbb.png'
    const imageData = new ArrayBuffer(16)

    mockR2List.mockResolvedValue({
      objects: [{ key: key1 }, { key: key2 }],
    })
    // Last served was key1
    mockKvGet.mockResolvedValue(key1)
    mockR2Get.mockResolvedValue({
      arrayBuffer: () => Promise.resolve(imageData),
    })
    mockKvPut.mockResolvedValue(undefined)

    const result = await getRandomPoolImage('U123', 1)
    expect(result).toBe(imageData)
    // Should have fetched key2 (not key1)
    expect(mockR2Get).toHaveBeenCalledWith(key2)
  })

  it('should allow repeat when pool has only one image', async () => {
    const key1 = 'character/U123/pool/stage1/2026-02-24-aaa.png'
    const imageData = new ArrayBuffer(16)

    mockR2List.mockResolvedValue({
      objects: [{ key: key1 }],
    })
    mockKvGet.mockResolvedValue(key1)
    mockR2Get.mockResolvedValue({
      arrayBuffer: () => Promise.resolve(imageData),
    })
    mockKvPut.mockResolvedValue(undefined)

    const result = await getRandomPoolImage('U123', 1)
    expect(result).toBe(imageData)
    expect(mockR2Get).toHaveBeenCalledWith(key1)
  })
})

describe('pickRandomPoolKey', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return null when pool is empty', async () => {
    mockR2List.mockResolvedValue({ objects: [] })

    const result = await pickRandomPoolKey('U123', 1)
    expect(result).toBeNull()
  })

  it('should return a key from the pool', async () => {
    const key = 'character/U123/pool/stage1/2026-02-24-abc12345.png'
    mockR2List.mockResolvedValue({ objects: [{ key }] })
    mockKvGet.mockResolvedValue(null)
    mockKvPut.mockResolvedValue(undefined)

    const result = await pickRandomPoolKey('U123', 1)
    expect(result).toBe(key)
  })

  it('should avoid repeating the last served key', async () => {
    const key1 = 'character/U123/pool/stage1/2026-02-24-aaa.png'
    const key2 = 'character/U123/pool/stage1/2026-02-24-bbb.png'

    mockR2List.mockResolvedValue({
      objects: [{ key: key1 }, { key: key2 }],
    })
    mockKvGet.mockResolvedValue(key1)
    mockKvPut.mockResolvedValue(undefined)

    const result = await pickRandomPoolKey('U123', 1)
    expect(result).toBe(key2)
  })
})

describe('extractImageId', () => {
  it('should extract image ID from pool key', () => {
    const key = 'character/U123/pool/stage1/2026-02-27-abc12345.png'
    expect(extractImageId(key)).toBe('2026-02-27-abc12345')
  })

  it('should handle keys without extension', () => {
    const key = 'character/U123/pool/stage1/2026-02-27-abc12345'
    expect(extractImageId(key)).toBe('2026-02-27-abc12345')
  })

  it('should handle empty key', () => {
    expect(extractImageId('')).toBe('')
  })
})

describe('getPoolImageById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return image when found', async () => {
    const imageData = new ArrayBuffer(16)
    mockR2Get.mockResolvedValue({
      arrayBuffer: () => Promise.resolve(imageData),
    })

    const result = await getPoolImageById('U123', '2026-02-27-abc12345')
    expect(result).toBe(imageData)
    expect(mockR2Get).toHaveBeenCalledWith(
      'character/U123/pool/stage1/2026-02-27-abc12345.png',
    )
  })

  it('should search across stages', async () => {
    const imageData = new ArrayBuffer(16)
    // Not found in stage 1, 2, found in stage 3
    mockR2Get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        arrayBuffer: () => Promise.resolve(imageData),
      })

    const result = await getPoolImageById('U123', '2026-02-27-abc12345')
    expect(result).toBe(imageData)
    expect(mockR2Get).toHaveBeenCalledTimes(3)
  })

  it('should return null when not found in any stage', async () => {
    mockR2Get.mockResolvedValue(null)

    const result = await getPoolImageById('U123', '2026-02-27-abc12345')
    expect(result).toBeNull()
    expect(mockR2Get).toHaveBeenCalledTimes(5) // Checked all 5 stages
  })
})

describe('constants', () => {
  it('should have reasonable defaults', () => {
    expect(DAILY_GENERATION_CAP).toBe(3)
    expect(POOL_ACTIVE_DAYS).toBe(7)
  })
})
