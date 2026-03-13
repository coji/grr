/**
 * Suno API クライアント
 *
 * gcui-art/suno-api (self-hosted on Vercel) と連携するクライアント。
 * Cookie ベースの認証はサーバー側で処理されるため、APIキーは不要。
 *
 * 参考: https://github.com/gcui-art/suno-api
 */

import { env } from 'cloudflare:workers'

// ============================================
// Types
// ============================================

export interface SunoGenerateOptions {
  /** 歌詞（custom mode） */
  prompt: string
  /** 音楽スタイル（例: "japanese pop, warm acoustic"） */
  style: string
  /** 曲タイトル */
  title: string
  /** インストゥルメンタルかどうか */
  instrumental?: boolean
  /** モデルバージョン（デフォルト: v4） */
  model?: string
}

export type SunoTaskStatus =
  | 'queued'
  | 'processing'
  | 'streaming'
  | 'completed'
  | 'failed'

export interface SunoGenerateResult {
  /** タスクID（ポーリング用） */
  taskId: string
  /** 現在のステータス */
  status: SunoTaskStatus
  /** 生成された音楽URL（完了時） */
  audioUrl?: string
  /** 生成されたビデオURL（あれば） */
  videoUrl?: string
  /** エラーメッセージ（失敗時） */
  errorMessage?: string
}

// ============================================
// API Response Types (gcui-art/suno-api)
// ============================================

interface SunoAudioInfo {
  id: string
  title?: string
  audio_url?: string
  video_url?: string
  status: string
  error_message?: string
  duration?: string
  tags?: string
  lyric?: string
  created_at: string
  model_name: string
}

// ============================================
// Client Implementation
// ============================================

/**
 * Suno API のベース URL を取得
 */
function getBaseUrl(): string {
  const url = (env as unknown as Record<string, string | undefined>)
    .SUNO_API_URL
  if (!url) {
    throw new Error('SUNO_API_URL is not configured')
  }
  return url.replace(/\/$/, '') // Remove trailing slash
}

/**
 * 音楽生成をリクエスト
 *
 * gcui-art/suno-api の /api/custom_generate エンドポイントを使用。
 * 2曲生成されるが、最初の1曲のIDを返す。
 */
export async function generateMusic(
  options: SunoGenerateOptions,
): Promise<SunoGenerateResult> {
  const baseUrl = getBaseUrl()

  const response = await fetch(`${baseUrl}/api/custom_generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: options.prompt,
      tags: options.style,
      title: options.title,
      make_instrumental: options.instrumental ?? false,
      model: options.model ?? 'v4',
      wait_audio: false,
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Suno API error: ${response.status} - ${errorText}`)
  }

  const data = (await response.json()) as SunoAudioInfo[]

  if (!data || data.length === 0) {
    throw new Error('Suno API returned no audio data')
  }

  // 最初の曲を使用
  const audio = data[0]

  return {
    taskId: audio.id,
    status: normalizeStatus(audio.status),
    audioUrl: audio.audio_url || undefined,
    videoUrl: audio.video_url || undefined,
    errorMessage: audio.error_message || undefined,
  }
}

/**
 * タスクステータスを確認
 *
 * gcui-art/suno-api の /api/get?ids= エンドポイントを使用。
 */
export async function checkMusicStatus(
  taskId: string,
): Promise<SunoGenerateResult> {
  const baseUrl = getBaseUrl()

  const response = await fetch(
    `${baseUrl}/api/get?ids=${encodeURIComponent(taskId)}`,
    {
      method: 'GET',
    },
  )

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Suno API error: ${response.status} - ${errorText}`)
  }

  const data = (await response.json()) as SunoAudioInfo[]

  if (!data || data.length === 0) {
    throw new Error(`No audio found for task: ${taskId}`)
  }

  const audio = data[0]

  return {
    taskId: audio.id,
    status: normalizeStatus(audio.status),
    audioUrl: audio.audio_url || undefined,
    videoUrl: audio.video_url || undefined,
    errorMessage: audio.error_message || undefined,
  }
}

/**
 * API ステータスを正規化
 */
function normalizeStatus(status: string): SunoTaskStatus {
  const normalized = status.toLowerCase()
  switch (normalized) {
    case 'queued':
    case 'pending':
      return 'queued'
    case 'processing':
    case 'running':
      return 'processing'
    case 'streaming':
      return 'streaming'
    case 'completed':
    case 'complete':
    case 'success':
      return 'completed'
    case 'failed':
    case 'error':
      return 'failed'
    default:
      return 'processing'
  }
}

/**
 * Suno API が設定されているかどうかを確認
 */
export function isSunoConfigured(): boolean {
  const url = (env as unknown as Record<string, string | undefined>)
    .SUNO_API_URL
  return !!url
}
