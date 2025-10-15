import { Form, useActionData } from 'react-router'
import { generateDiaryReminder, generateDiaryReply } from '~/services/ai'
import type { Route } from './+types/test'

type ActionData =
  | {
      type: 'reply'
      result: string
      input: {
        personaName: string
        userId: string
        moodLabel?: string
        latestEntry?: string
        mentionMessage?: string
      }
    }
  | {
      type: 'reminder'
      result: string
      input: {
        personaName: string
        userId: string
        moodOptions: Array<{ emoji: string; label: string }>
      }
    }
  | { type: 'error'; error: string }

export const action = async ({ request, context }: Route.ActionArgs) => {
  const env = context.cloudflare.env as Env
  const formData = await request.formData()
  const actionType = formData.get('actionType')

  try {
    if (actionType === 'reply') {
      const personaName = formData.get('personaName') as string
      const userId = formData.get('userId') as string
      const moodLabel = formData.get('moodLabel') as string | null
      const latestEntry = formData.get('latestEntry') as string | null
      const mentionMessage = formData.get('mentionMessage') as string | null

      const result = await generateDiaryReply({
        env,
        personaName,
        userId,
        moodLabel: moodLabel || undefined,
        latestEntry: latestEntry || undefined,
        mentionMessage: mentionMessage || undefined,
      })

      console.log({ result })

      return {
        type: 'reply',
        result,
        input: {
          personaName,
          userId,
          moodLabel: moodLabel || undefined,
          latestEntry: latestEntry || undefined,
          mentionMessage: mentionMessage || undefined,
        },
      } satisfies ActionData
    }

    if (actionType === 'reminder') {
      const personaName = formData.get('personaName') as string
      const userId = formData.get('userId') as string
      const moodOptionsStr = formData.get('moodOptions') as string

      let moodOptions: Array<{ emoji: string; label: string }> = []
      try {
        moodOptions = JSON.parse(moodOptionsStr)
      } catch {
        return {
          type: 'error',
          error: 'Invalid moodOptions JSON format',
        } satisfies ActionData
      }

      const result = await generateDiaryReminder({
        env,
        personaName,
        userId,
        moodOptions,
      })

      return {
        type: 'reminder',
        result,
        input: {
          personaName,
          userId,
          moodOptions,
        },
      } satisfies ActionData
    }

    return {
      type: 'error',
      error: 'Invalid action type',
    } satisfies ActionData
  } catch (error) {
    return {
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    } satisfies ActionData
  }
}

export default function TestPage() {
  const actionData = useActionData<typeof action>()

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-8 text-3xl font-bold text-gray-900">
          AI Service Test Page
        </h1>

        <div className="space-y-8">
          {/* Diary Reply Test */}
          <section className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-2xl font-semibold text-gray-800">
              Generate Diary Reply
            </h2>
            <Form method="post" className="space-y-4">
              <input type="hidden" name="actionType" value="reply" />

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Persona Name
                  <input
                    type="text"
                    name="personaName"
                    defaultValue="ほたる"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    required
                  />
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  User ID
                  <input
                    type="text"
                    name="userId"
                    defaultValue="U12345"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    required
                  />
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Mood Label (optional)
                  <input
                    type="text"
                    name="moodLabel"
                    placeholder="例: 嬉しい"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Latest Entry (optional)
                  <textarea
                    name="latestEntry"
                    placeholder="例: 今日は良い天気でした"
                    rows={3}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Mention Message (optional)
                  <textarea
                    name="mentionMessage"
                    placeholder="例: ありがとう"
                    rows={2}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                  />
                </label>
              </div>

              <button
                type="submit"
                className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700"
              >
                Generate Reply
              </button>
            </Form>
          </section>

          {/* Diary Reminder Test */}
          <section className="rounded-lg bg-white p-6 shadow">
            <h2 className="mb-4 text-2xl font-semibold text-gray-800">
              Generate Diary Reminder
            </h2>
            <Form method="post" className="space-y-4">
              <input type="hidden" name="actionType" value="reminder" />

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Persona Name
                  <input
                    type="text"
                    name="personaName"
                    defaultValue="ほたる"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    required
                  />
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  User ID
                  <input
                    type="text"
                    name="userId"
                    defaultValue="U12345"
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2"
                    required
                  />
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Mood Options (JSON)
                  <textarea
                    name="moodOptions"
                    defaultValue={JSON.stringify(
                      [
                        { emoji: '😊', label: '嬉しい' },
                        { emoji: '😢', label: '悲しい' },
                        { emoji: '😌', label: '穏やか' },
                      ],
                      null,
                      2,
                    )}
                    rows={6}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm"
                    required
                  />
                </label>
              </div>

              <button
                type="submit"
                className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700"
              >
                Generate Reminder
              </button>
            </Form>
          </section>

          {/* Results */}
          {actionData && (
            <section className="rounded-lg bg-white p-6 shadow">
              <h2 className="mb-4 text-2xl font-semibold text-gray-800">
                Result
              </h2>

              {actionData.type === 'error' && (
                <div className="rounded-md bg-red-50 p-4 text-red-800">
                  <p className="font-semibold">Error:</p>
                  <p>{actionData.error}</p>
                </div>
              )}

              {actionData.type === 'reply' && (
                <div className="space-y-4">
                  <div className="rounded-md bg-blue-50 p-4">
                    <p className="mb-2 font-semibold text-blue-900">
                      Generated Reply:
                    </p>
                    <p className="text-lg text-blue-800">{actionData.result}</p>
                    <p className="mt-2 text-sm text-blue-600">
                      Length: {Array.from(actionData.result).length} characters
                    </p>
                  </div>
                  <details className="rounded-md bg-gray-50 p-4">
                    <summary className="cursor-pointer font-semibold text-gray-700">
                      Input Parameters
                    </summary>
                    <pre className="mt-2 text-sm text-gray-600">
                      {JSON.stringify(actionData.input, null, 2)}
                    </pre>
                  </details>
                </div>
              )}

              {actionData.type === 'reminder' && (
                <div className="space-y-4">
                  <div className="rounded-md bg-green-50 p-4">
                    <p className="mb-2 font-semibold text-green-900">
                      Generated Reminder:
                    </p>
                    <p className="text-lg text-green-800">
                      {actionData.result}
                    </p>
                    <p className="mt-2 text-sm text-green-600">
                      Length: {Array.from(actionData.result).length} characters
                    </p>
                  </div>
                  <details className="rounded-md bg-gray-50 p-4">
                    <summary className="cursor-pointer font-semibold text-gray-700">
                      Input Parameters
                    </summary>
                    <pre className="mt-2 text-sm text-gray-600">
                      {JSON.stringify(actionData.input, null, 2)}
                    </pre>
                  </details>
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
