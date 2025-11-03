import { describe, expect, it } from 'vitest'
import { sanitizeText } from './utils'

describe('sanitizeText', () => {
  it('should remove Slack user mentions', () => {
    const input = 'Hello <@U12345> how are you?'
    const result = sanitizeText(input)
    expect(result).toBe('Hello  how are you?')
  })

  it('should decode HTML entities', () => {
    const input = '&lt;script&gt;alert(&amp;)&lt;/script&gt;'
    const result = sanitizeText(input)
    expect(result).toBe('<script>alert(&)</script>')
  })

  it('should handle undefined input', () => {
    const result = sanitizeText(undefined)
    expect(result).toBe('')
  })

  it('should trim whitespace', () => {
    const input = '  hello world  '
    const result = sanitizeText(input)
    expect(result).toBe('hello world')
  })

  it('should handle empty string', () => {
    const result = sanitizeText('')
    expect(result).toBe('')
  })

  it('should remove multiple user mentions', () => {
    const input = '<@U123> mentioned <@U456> in the conversation'
    const result = sanitizeText(input)
    expect(result).toBe('mentioned  in the conversation')
  })

  it('should handle combined transformations', () => {
    const input = '  <@U123> said &lt;Hello&gt; &amp; goodbye  '
    const result = sanitizeText(input)
    expect(result).toBe('said <Hello> & goodbye')
  })
})
