/**
 * File utilities for handling Slack file attachments in diary entries
 */

// Slack file object type (from Slack API)
export interface SlackFile {
  id: string
  name: string
  mimetype?: string
  filetype?: string
  size?: number
  url_private?: string
  permalink?: string
  thumb_360?: string
  thumb_video?: string
  original_w?: number
  original_h?: number
}

export type FileType = 'image' | 'video' | 'document'

// Maximum number of attachments per diary entry
export const MAX_ATTACHMENTS_PER_ENTRY = 10

// Supported file types by category
const SUPPORTED_FILE_TYPES: Record<FileType, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'],
  video: ['mp4', 'mov', 'avi', 'wmv', 'flv', 'webm'],
  document: ['pdf', 'txt', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'],
}

// MIME type patterns for categorization
const MIME_TYPE_PATTERNS: Record<FileType, RegExp> = {
  image: /^image\//,
  video: /^video\//,
  document: /^(application|text)\//,
}

/**
 * Categorize a file based on its MIME type and file extension
 * @param file - Slack file object
 * @returns File type category or null if not supported
 */
export function categorizeFileType(file: SlackFile): FileType | null {
  // First try MIME type
  if (file.mimetype) {
    for (const [type, pattern] of Object.entries(MIME_TYPE_PATTERNS)) {
      if (pattern.test(file.mimetype)) {
        return type as FileType
      }
    }
  }

  // Fallback to file extension
  if (file.filetype) {
    const extension = file.filetype.toLowerCase()
    for (const [type, extensions] of Object.entries(SUPPORTED_FILE_TYPES)) {
      if (extensions.includes(extension)) {
        return type as FileType
      }
    }
  }

  return null
}

/**
 * Check if a file is supported for diary attachments
 * @param file - Slack file object
 * @returns True if file is supported
 */
export function isSupportedFile(file: SlackFile): boolean {
  return categorizeFileType(file) !== null
}

/**
 * Filter and limit files to supported types and max count
 * @param files - Array of Slack file objects
 * @param maxCount - Maximum number of files to return (default: MAX_ATTACHMENTS_PER_ENTRY)
 * @returns Filtered and limited array of files
 */
export function filterSupportedFiles(
  files: SlackFile[],
  maxCount: number = MAX_ATTACHMENTS_PER_ENTRY,
): SlackFile[] {
  return files.filter(isSupportedFile).slice(0, maxCount)
}

/**
 * Get a human-readable label for a file type
 * @param fileType - File type category
 * @returns Japanese label for the file type
 */
export function getFileTypeLabel(fileType: FileType): string {
  const labels: Record<FileType, string> = {
    image: '画像',
    video: '動画',
    document: 'ドキュメント',
  }
  return labels[fileType]
}

/**
 * Get an emoji icon for a file type
 * @param fileType - File type category
 * @returns Emoji representing the file type
 */
export function getFileTypeEmoji(fileType: FileType): string {
  const emojis: Record<FileType, string> = {
    image: '🖼️',
    video: '🎬',
    document: '📄',
  }
  return emojis[fileType]
}
