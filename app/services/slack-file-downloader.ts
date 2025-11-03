/**
 * Service for downloading files from Slack with authentication
 */

// Maximum file size per image (10 MB)
export const MAX_FILE_SIZE = 10 * 1024 * 1024

// Maximum total size for all images (30 MB)
export const MAX_TOTAL_SIZE = 30 * 1024 * 1024

// Download timeout (10 seconds)
const DOWNLOAD_TIMEOUT = 10000

export interface DownloadedFile {
  buffer: Buffer
  mimeType: string
  size: number
}

export class FileSizeError extends Error {
  constructor(
    message: string,
    public fileSize: number,
    public maxSize: number,
  ) {
    super(message)
    this.name = 'FileSizeError'
  }
}

export class FileDownloadError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = 'FileDownloadError'
  }
}

/**
 * Check file size via HEAD request before downloading
 * @param urlPrivate - Slack private file URL
 * @param botToken - Slack bot token for authentication
 * @returns File size in bytes
 * @throws FileSizeError if file is too large
 * @throws FileDownloadError if request fails
 */
export async function checkFileSize(
  urlPrivate: string,
  botToken: string,
): Promise<number> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)

  try {
    const response = await fetch(urlPrivate, {
      method: 'HEAD',
      headers: {
        Authorization: `Bearer ${botToken}`,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      throw new FileDownloadError(
        `Failed to check file size: ${response.status} ${response.statusText}`,
        response.status,
      )
    }

    const contentLength = response.headers.get('content-length')
    if (!contentLength) {
      // If content-length is not available, assume it's safe and proceed
      return 0
    }

    return Number.parseInt(contentLength, 10)
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Download a file from Slack with authentication
 * @param urlPrivate - Slack private file URL
 * @param botToken - Slack bot token for authentication
 * @param maxSize - Maximum allowed file size (default: MAX_FILE_SIZE)
 * @returns Downloaded file with buffer and metadata
 * @throws FileSizeError if file exceeds size limit
 * @throws FileDownloadError if download fails
 */
export async function downloadSlackFile(
  urlPrivate: string,
  botToken: string,
  maxSize: number = MAX_FILE_SIZE,
): Promise<DownloadedFile> {
  // Check file size before downloading
  const fileSize = await checkFileSize(urlPrivate, botToken)
  if (fileSize > 0 && fileSize > maxSize) {
    throw new FileSizeError(
      `File size ${fileSize} bytes exceeds maximum ${maxSize} bytes`,
      fileSize,
      maxSize,
    )
  }

  // Download the file
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT)

  try {
    const response = await fetch(urlPrivate, {
      headers: {
        Authorization: `Bearer ${botToken}`,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      // Log response body for debugging (limit to first 500 chars)
      const bodyText = await response
        .text()
        .catch(() => '[unable to read body]')
      const truncatedBody =
        bodyText.length > 500 ? `${bodyText.slice(0, 500)}...` : bodyText
      console.error('File download failed:', {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        bodyPreview: truncatedBody,
      })
      throw new FileDownloadError(
        `Failed to download file: ${response.status} ${response.statusText}`,
        response.status,
      )
    }

    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const mimeType =
      response.headers.get('content-type') || 'application/octet-stream'

    // Debug: Log response details for text/html responses (likely errors)
    if (mimeType.includes('text/html')) {
      const bodyPreview = buffer.toString(
        'utf-8',
        0,
        Math.min(500, buffer.length),
      )
      console.error('Received HTML instead of file:', {
        url: urlPrivate.substring(0, 100),
        status: response.status,
        statusText: response.statusText,
        mimeType,
        size: buffer.length,
        bodyPreview,
      })
    }

    return {
      buffer,
      mimeType,
      size: buffer.length,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

/**
 * Download multiple files from Slack with total size limit
 * @param files - Array of file URLs to download
 * @param botToken - Slack bot token for authentication
 * @param maxTotalSize - Maximum total size for all files (default: MAX_TOTAL_SIZE)
 * @returns Array of successfully downloaded files (skips files that exceed limits or fail)
 */
export async function downloadSlackFiles(
  files: Array<{ urlPrivate: string; fileName: string }>,
  botToken: string,
  maxTotalSize: number = MAX_TOTAL_SIZE,
): Promise<Array<DownloadedFile & { fileName: string }>> {
  const downloaded: Array<DownloadedFile & { fileName: string }> = []
  let totalSize = 0

  for (const file of files) {
    try {
      const downloadedFile = await downloadSlackFile(
        file.urlPrivate,
        botToken,
        MAX_FILE_SIZE,
      )

      // Check total size limit
      if (totalSize + downloadedFile.size > maxTotalSize) {
        console.warn(
          `Skipping file ${file.fileName}: would exceed total size limit (${totalSize + downloadedFile.size} > ${maxTotalSize})`,
        )
        break
      }

      totalSize += downloadedFile.size
      downloaded.push({
        ...downloadedFile,
        fileName: file.fileName,
      })
    } catch (error) {
      // Log error but continue with other files
      if (error instanceof FileSizeError) {
        console.warn(`Skipping file ${file.fileName}: ${error.message}`)
      } else if (error instanceof FileDownloadError) {
        console.error(`Failed to download ${file.fileName}:`, error.message)
      } else {
        console.error(`Unexpected error downloading ${file.fileName}:`, error)
      }
    }
  }

  return downloaded
}
