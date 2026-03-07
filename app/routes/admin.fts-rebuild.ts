import { env } from 'cloudflare:workers'
import { rebuildFtsIndex } from '~/services/diary-search'
import type { Route } from './+types/admin.fts-rebuild'

export const action = async ({ request }: Route.ActionArgs) => {
  // Only accept POST
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }

  // Verify admin token
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token || token !== env.ADMIN_API_TOKEN) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const indexed = await rebuildFtsIndex()
    return Response.json({ ok: true, indexed })
  } catch (error) {
    console.error('FTS rebuild failed:', error)
    return Response.json(
      { error: 'FTS rebuild failed', detail: String(error) },
      { status: 500 },
    )
  }
}
