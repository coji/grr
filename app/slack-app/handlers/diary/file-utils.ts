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
  url_private_download?: string // For bot token authentication
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

// Safe MIME type whitelists for categorization
// Using strict whitelists to prevent accepting dangerous files like executables or archives
const SAFE_MIME_TYPES: Record<FileType, string[]> = {
  image: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/svg+xml',
  ],
  video: [
    'video/mp4',
    'video/quicktime',
    'video/x-msvideo',
    'video/x-ms-wmv',
    'video/x-flv',
    'video/webm',
  ],
  document: [
    // PDF
    'application/pdf',
    // Plain text
    'text/plain',
    // Microsoft Office (legacy)
    'application/msword',
    'application/vnd.ms-excel',
    'application/vnd.ms-powerpoint',
    // Microsoft Office (modern OpenXML)
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Rich Text Format
    'application/rtf',
  ],
}

/**
 * Categorize a file based on its file extension and MIME type
 * Uses extension-first checking with MIME type as a strict whitelist fallback
 * to prevent accepting dangerous files like executables or archives
 * @param file - Slack file object
 * @returns File type category or null if not supported
 */
export function categorizeFileType(file: SlackFile): FileType | null {
  // Primary check: file extension (most reliable)
  if (file.filetype) {
    const extension = file.filetype.toLowerCase()
    for (const [type, extensions] of Object.entries(SUPPORTED_FILE_TYPES)) {
      if (extensions.includes(extension)) {
        return type as FileType
      }
    }
  }

  // Fallback: MIME type whitelist (strict check to prevent dangerous files)
  if (file.mimetype) {
    const mimeType = file.mimetype.toLowerCase()
    for (const [type, safeMimeTypes] of Object.entries(SAFE_MIME_TYPES)) {
      if (safeMimeTypes.includes(mimeType)) {
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
