export const TOKYO_TZ = 'Asia/Tokyo'

export const sanitizeText = (text: string | undefined) =>
  text
    ?.replace(/<@[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim() ?? ''
