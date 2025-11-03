import { describe, expect, it } from 'vitest'
import {
  type SlackFile,
  categorizeFileType,
  filterSupportedFiles,
  getFileTypeEmoji,
  getFileTypeLabel,
  isSupportedFile,
} from './file-utils'

describe('file-utils', () => {
  describe('categorizeFileType', () => {
    it('should categorize image files by MIME type', () => {
      const imageFile: SlackFile = {
        id: 'F123',
        name: 'photo.jpg',
        mimetype: 'image/jpeg',
      }
      expect(categorizeFileType(imageFile)).toBe('image')
    })

    it('should categorize video files by MIME type', () => {
      const videoFile: SlackFile = {
        id: 'F124',
        name: 'video.mp4',
        mimetype: 'video/mp4',
      }
      expect(categorizeFileType(videoFile)).toBe('video')
    })

    it('should categorize document files by MIME type', () => {
      const docFile: SlackFile = {
        id: 'F125',
        name: 'document.pdf',
        mimetype: 'application/pdf',
      }
      expect(categorizeFileType(docFile)).toBe('document')
    })

    it('should categorize files by extension when MIME type is missing', () => {
      const pngFile: SlackFile = {
        id: 'F126',
        name: 'image.png',
        filetype: 'png',
      }
      expect(categorizeFileType(pngFile)).toBe('image')
    })

    it('should return null for unsupported file types', () => {
      const unknownFile: SlackFile = {
        id: 'F127',
        name: 'unknown.xyz',
        mimetype: 'audio/mpeg', // audio files are not supported
        filetype: 'mp3',
      }
      expect(categorizeFileType(unknownFile)).toBeNull()
    })

    it('should handle files with no MIME type or extension', () => {
      const unknownFile: SlackFile = {
        id: 'F128',
        name: 'file',
      }
      expect(categorizeFileType(unknownFile)).toBeNull()
    })
  })

  describe('isSupportedFile', () => {
    it('should return true for supported image files', () => {
      const imageFile: SlackFile = {
        id: 'F123',
        name: 'photo.jpg',
        mimetype: 'image/jpeg',
      }
      expect(isSupportedFile(imageFile)).toBe(true)
    })

    it('should return true for supported video files', () => {
      const videoFile: SlackFile = {
        id: 'F124',
        name: 'video.mp4',
        mimetype: 'video/mp4',
      }
      expect(isSupportedFile(videoFile)).toBe(true)
    })

    it('should return true for supported document files', () => {
      const docFile: SlackFile = {
        id: 'F125',
        name: 'document.pdf',
        mimetype: 'application/pdf',
      }
      expect(isSupportedFile(docFile)).toBe(true)
    })

    it('should return false for unsupported files', () => {
      const unknownFile: SlackFile = {
        id: 'F126',
        name: 'audio.mp3',
        mimetype: 'audio/mpeg', // audio files are not supported
      }
      expect(isSupportedFile(unknownFile)).toBe(false)
    })
  })

  describe('filterSupportedFiles', () => {
    it('should filter out unsupported files', () => {
      const files: SlackFile[] = [
        { id: 'F1', name: 'photo.jpg', mimetype: 'image/jpeg' },
        { id: 'F2', name: 'audio.mp3', mimetype: 'audio/mpeg' }, // audio not supported
        { id: 'F3', name: 'video.mp4', mimetype: 'video/mp4' },
      ]
      const result = filterSupportedFiles(files)
      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('F1')
      expect(result[1].id).toBe('F3')
    })

    it('should limit files to max count', () => {
      const files: SlackFile[] = Array.from({ length: 15 }, (_, i) => ({
        id: `F${i}`,
        name: `photo${i}.jpg`,
        mimetype: 'image/jpeg',
      }))
      const result = filterSupportedFiles(files, 5)
      expect(result).toHaveLength(5)
    })

    it('should default to MAX_ATTACHMENTS_PER_ENTRY', () => {
      const files: SlackFile[] = Array.from({ length: 15 }, (_, i) => ({
        id: `F${i}`,
        name: `photo${i}.jpg`,
        mimetype: 'image/jpeg',
      }))
      const result = filterSupportedFiles(files)
      expect(result).toHaveLength(10) // MAX_ATTACHMENTS_PER_ENTRY = 10
    })

    it('should return empty array for no files', () => {
      const result = filterSupportedFiles([])
      expect(result).toHaveLength(0)
    })
  })

  describe('getFileTypeLabel', () => {
    it('should return Japanese label for image', () => {
      expect(getFileTypeLabel('image')).toBe('画像')
    })

    it('should return Japanese label for video', () => {
      expect(getFileTypeLabel('video')).toBe('動画')
    })

    it('should return Japanese label for document', () => {
      expect(getFileTypeLabel('document')).toBe('ドキュメント')
    })
  })

  describe('getFileTypeEmoji', () => {
    it('should return emoji for image', () => {
      expect(getFileTypeEmoji('image')).toBe('🖼️')
    })

    it('should return emoji for video', () => {
      expect(getFileTypeEmoji('video')).toBe('🎬')
    })

    it('should return emoji for document', () => {
      expect(getFileTypeEmoji('document')).toBe('📄')
    })
  })
})
