import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockR2Get, mockR2Put, mockR2Head, mockR2Delete } = vi.hoisted(() => ({
  mockR2Get: vi.fn(),
  mockR2Put: vi.fn(),
  mockR2Head: vi.fn(),
  mockR2Delete: vi.fn(),
}))

vi.mock('cloudflare:workers', () => ({
  env: {
    CHARACTER_IMAGES: {
      get: mockR2Get,
      put: mockR2Put,
      head: mockR2Head,
      delete: mockR2Delete,
    },
  },
}))

import {
  deleteRoomImage,
  getRoomImage,
  hasRoomImage,
  putRoomImage,
} from './room-image'

describe('getRoomImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return image data when room image exists', async () => {
    const imageData = new ArrayBuffer(16)
    mockR2Get.mockResolvedValue({
      arrayBuffer: () => Promise.resolve(imageData),
    })

    const result = await getRoomImage('U123')
    expect(result).toBe(imageData)
    expect(mockR2Get).toHaveBeenCalledWith('room/U123/decorated.png')
  })

  it('should return null when no room image exists', async () => {
    mockR2Get.mockResolvedValue(null)

    const result = await getRoomImage('U123')
    expect(result).toBeNull()
  })
})

describe('putRoomImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should store image with correct key and content type', async () => {
    const pngData = new ArrayBuffer(8)
    await putRoomImage('U123', pngData)

    expect(mockR2Put).toHaveBeenCalledWith('room/U123/decorated.png', pngData, {
      httpMetadata: { contentType: 'image/png' },
    })
  })
})

describe('hasRoomImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should return true when room image exists', async () => {
    mockR2Head.mockResolvedValue({ key: 'room/U123/decorated.png' })

    const result = await hasRoomImage('U123')
    expect(result).toBe(true)
  })

  it('should return false when no room image exists', async () => {
    mockR2Head.mockResolvedValue(null)

    const result = await hasRoomImage('U123')
    expect(result).toBe(false)
  })
})

describe('deleteRoomImage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should delete room image with correct key', async () => {
    await deleteRoomImage('U123')

    expect(mockR2Delete).toHaveBeenCalledWith('room/U123/decorated.png')
  })
})
