import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FileDownloadError,
  FileSizeError,
  MAX_FILE_SIZE,
  MAX_TOTAL_SIZE,
  checkFileSize,
  downloadSlackFile,
  downloadSlackFiles,
} from './slack-file-downloader'

// Mock fetch globally
global.fetch = vi.fn()

describe('slack-file-downloader', () => {
  const mockBotToken = 'xoxb-test-token'
  const mockUrl = 'https://files.slack.com/files-pri/T123/F456/test.jpg'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('checkFileSize', () => {
    it('should return file size from content-length header', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            'content-length': '1234567',
          },
        }),
      )

      const size = await checkFileSize(mockUrl, mockBotToken)

      expect(size).toBe(1234567)
      expect(fetch).toHaveBeenCalledWith(
        mockUrl,
        expect.objectContaining({
          method: 'HEAD',
          headers: {
            Authorization: `Bearer ${mockBotToken}`,
          },
        }),
      )
    })

    it('should return 0 if content-length is not available', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, {
          status: 200,
        }),
      )

      const size = await checkFileSize(mockUrl, mockBotToken)

      expect(size).toBe(0)
    })

    it('should throw FileDownloadError on HTTP error', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, {
          status: 403,
          statusText: 'Forbidden',
        }),
      )

      await expect(checkFileSize(mockUrl, mockBotToken)).rejects.toThrow(
        FileDownloadError,
      )
    })
  })

  describe('downloadSlackFile', () => {
    const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]) // JPEG header
    const mockBuffer = Buffer.from(mockImageData)

    it('should download file successfully', async () => {
      // Mock HEAD request
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            'content-length': String(mockImageData.length),
          },
        }),
      )

      // Mock GET request
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(mockBuffer, {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
          },
        }),
      )

      const result = await downloadSlackFile(mockUrl, mockBotToken)

      expect(result.buffer).toEqual(mockBuffer)
      expect(result.mimeType).toBe('image/jpeg')
      expect(result.size).toBe(mockImageData.length)
    })

    it('should use default mime type if not provided', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            'content-length': String(mockImageData.length),
          },
        }),
      )

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(mockBuffer, {
          status: 200,
        }),
      )

      const result = await downloadSlackFile(mockUrl, mockBotToken)

      expect(result.mimeType).toBe('application/octet-stream')
    })

    it('should throw FileSizeError if file exceeds size limit', async () => {
      const largeFileSize = MAX_FILE_SIZE + 1000

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            'content-length': String(largeFileSize),
          },
        }),
      )

      await expect(downloadSlackFile(mockUrl, mockBotToken)).rejects.toThrow(
        FileSizeError,
      )
    })

    it('should accept custom max size', async () => {
      const customMaxSize = 1000
      const fileSize = 500

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            'content-length': String(fileSize),
          },
        }),
      )

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(mockBuffer, {
          status: 200,
          headers: {
            'content-type': 'image/jpeg',
          },
        }),
      )

      const result = await downloadSlackFile(
        mockUrl,
        mockBotToken,
        customMaxSize,
      )

      expect(result.size).toBe(mockImageData.length)
    })

    it('should throw FileDownloadError on download failure', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            'content-length': String(mockImageData.length),
          },
        }),
      )

      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, {
          status: 500,
          statusText: 'Internal Server Error',
        }),
      )

      await expect(downloadSlackFile(mockUrl, mockBotToken)).rejects.toThrow(
        FileDownloadError,
      )
    })
  })

  describe('downloadSlackFiles', () => {
    const mockFile1 = {
      urlPrivate: 'https://example.com/file1.jpg',
      fileName: 'file1.jpg',
    }
    const mockFile2 = {
      urlPrivate: 'https://example.com/file2.jpg',
      fileName: 'file2.jpg',
    }
    const mockFile3 = {
      urlPrivate: 'https://example.com/file3.jpg',
      fileName: 'file3.jpg',
    }

    const mockImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])
    const mockBuffer = Buffer.from(mockImageData)

    it('should download multiple files successfully', async () => {
      // Mock HEAD and GET for file1
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: { 'content-length': String(mockImageData.length) },
          }),
        )
        .mockResolvedValueOnce(
          new Response(mockBuffer, {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        )

      // Mock HEAD and GET for file2
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: { 'content-length': String(mockImageData.length) },
          }),
        )
        .mockResolvedValueOnce(
          new Response(mockBuffer, {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        )

      const result = await downloadSlackFiles(
        [mockFile1, mockFile2],
        mockBotToken,
      )

      expect(result).toHaveLength(2)
      expect(result[0].fileName).toBe('file1.jpg')
      expect(result[1].fileName).toBe('file2.jpg')
    })

    it('should skip files that exceed individual size limit', async () => {
      const largeFileSize = MAX_FILE_SIZE + 1000

      // Mock HEAD for file1 (too large)
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'content-length': String(largeFileSize) },
        }),
      )

      // Mock HEAD and GET for file2 (normal size)
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: { 'content-length': String(mockImageData.length) },
          }),
        )
        .mockResolvedValueOnce(
          new Response(mockBuffer, {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        )

      const result = await downloadSlackFiles(
        [mockFile1, mockFile2],
        mockBotToken,
      )

      expect(result).toHaveLength(1)
      expect(result[0].fileName).toBe('file2.jpg')
    })

    it('should stop downloading when total size limit is reached', async () => {
      const fileSize = 15 * 1024 * 1024 // 15 MB per file
      const largeBuffer = Buffer.alloc(fileSize)

      // Mock HEAD and GET for file1 (15 MB)
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: { 'content-length': String(fileSize) },
          }),
        )
        .mockResolvedValueOnce(
          new Response(largeBuffer, {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        )

      // Mock HEAD and GET for file2 (15 MB)
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: { 'content-length': String(fileSize) },
          }),
        )
        .mockResolvedValueOnce(
          new Response(largeBuffer, {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        )

      // Mock HEAD for file3 (would exceed total)
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: { 'content-length': String(fileSize) },
        }),
      )

      const result = await downloadSlackFiles(
        [mockFile1, mockFile2, mockFile3],
        mockBotToken,
        MAX_TOTAL_SIZE,
      )

      // Should stop after 2 files (30 MB total)
      expect(result).toHaveLength(2)
    })

    it('should continue with other files if one fails', async () => {
      // Mock HEAD for file1 (fails)
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'))

      // Mock HEAD and GET for file2 (succeeds)
      vi.mocked(fetch)
        .mockResolvedValueOnce(
          new Response(null, {
            status: 200,
            headers: { 'content-length': String(mockImageData.length) },
          }),
        )
        .mockResolvedValueOnce(
          new Response(mockBuffer, {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
        )

      const result = await downloadSlackFiles(
        [mockFile1, mockFile2],
        mockBotToken,
      )

      expect(result).toHaveLength(1)
      expect(result[0].fileName).toBe('file2.jpg')
    })

    it('should return empty array if all downloads fail', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('Network error'))

      const result = await downloadSlackFiles([mockFile1], mockBotToken)

      expect(result).toHaveLength(0)
    })
  })
})
