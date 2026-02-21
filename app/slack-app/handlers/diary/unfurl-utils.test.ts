import { describe, expect, it } from 'vitest'
import { extractUnfurlsFromAttachments } from './unfurl-utils'

describe('extractUnfurlsFromAttachments', () => {
  it('extracts unfurl info from attachments with original_url', () => {
    const attachments = [
      {
        original_url: 'https://maps.app.goo.gl/abc123',
        title: 'イタリアンバルBAIA',
        text: '1 Chome-14-8 Nihonbashikakigaracho, Chuo City, Tokyo',
        service_name: 'google.com',
      },
    ]

    const result = extractUnfurlsFromAttachments(attachments)

    expect(result).toEqual([
      {
        url: 'https://maps.app.goo.gl/abc123',
        title: 'イタリアンバルBAIA',
        description: '1 Chome-14-8 Nihonbashikakigaracho, Chuo City, Tokyo',
        siteName: 'google.com',
      },
    ])
  })

  it('filters out attachments without original_url', () => {
    const attachments = [
      {
        // File attachment — no original_url
        title: 'photo.jpg',
        fallback: 'photo.jpg',
      },
      {
        original_url: 'https://example.com/article',
        title: 'Some Article',
        text: 'Article description',
        service_name: 'example.com',
      },
    ]

    const result = extractUnfurlsFromAttachments(attachments)

    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://example.com/article')
  })

  it('returns empty array for empty attachments', () => {
    expect(extractUnfurlsFromAttachments([])).toEqual([])
  })

  it('handles missing optional fields with null', () => {
    const attachments = [
      {
        original_url: 'https://example.com',
        // No title, text, or service_name
      },
    ]

    const result = extractUnfurlsFromAttachments(attachments)

    expect(result).toEqual([
      {
        url: 'https://example.com',
        title: null,
        description: null,
        siteName: null,
      },
    ])
  })

  it('handles multiple unfurls', () => {
    const attachments = [
      {
        original_url: 'https://example.com/a',
        title: 'Page A',
        text: 'Desc A',
        service_name: 'example.com',
      },
      {
        original_url: 'https://example.com/b',
        title: 'Page B',
        text: 'Desc B',
        service_name: 'example.com',
      },
    ]

    const result = extractUnfurlsFromAttachments(attachments)
    expect(result).toHaveLength(2)
  })

  it('filters out attachments with empty string original_url', () => {
    const attachments = [
      {
        original_url: '',
        title: 'Invalid',
      },
    ]

    const result = extractUnfurlsFromAttachments(attachments)
    expect(result).toEqual([])
  })
})
