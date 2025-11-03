import { http, HttpResponse } from 'msw'

/**
 * MSW handlers for mocking external HTTP requests in integration tests.
 * These handlers mock Slack API and Google AI API responses.
 */
export const handlers = [
  // Slack API - chat.postMessage
  http.post('https://slack.com/api/chat.postMessage', () => {
    return HttpResponse.json({
      ok: true,
      channel: 'C123',
      ts: '1234567890.123456',
      message: {
        text: 'Mock message',
        user: 'U123',
      },
    })
  }),

  // Slack API - chat.update
  http.post('https://slack.com/api/chat.update', () => {
    return HttpResponse.json({
      ok: true,
      channel: 'C123',
      ts: '1234567890.123456',
    })
  }),

  // Slack API - reactions.add
  http.post('https://slack.com/api/reactions.add', () => {
    return HttpResponse.json({
      ok: true,
    })
  }),

  // Slack API - reactions.remove
  http.post('https://slack.com/api/reactions.remove', () => {
    return HttpResponse.json({
      ok: true,
    })
  }),

  // Slack API - views.open
  http.post('https://slack.com/api/views.open', () => {
    return HttpResponse.json({
      ok: true,
      view: {
        id: 'V123',
        type: 'modal',
      },
    })
  }),

  // Slack API - views.update
  http.post('https://slack.com/api/views.update', () => {
    return HttpResponse.json({
      ok: true,
      view: {
        id: 'V123',
        type: 'modal',
      },
    })
  }),

  // Google AI API - generateContent
  http.post('https://generativelanguage.googleapis.com/*', () => {
    return HttpResponse.json({
      candidates: [
        {
          content: {
            parts: [
              {
                text: 'Mock AI response from Google Generative AI',
              },
            ],
          },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 10,
        candidatesTokenCount: 20,
        totalTokenCount: 30,
      },
    })
  }),
]
