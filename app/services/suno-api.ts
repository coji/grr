/**
 * Suno API クライアント
 *
 * Suno AI の音楽生成 API と連携するクライアント。
 * サードパーティプロバイダ (sunoapi.org など) を使用。
 *
 * 参考: https://docs.sunoapi.org/
 */

import { env } from 'cloudflare:workers'

// ============================================
// Types
// ============================================

export interface SunoGenerateOptions {
  /** 歌詞（custom mode）または説明文（description mode） */
  prompt: string
  /** 音楽スタイル（例: "japanese pop, warm acoustic"） */
  style: string
  /** 曲タイトル */
  title: string
  /** インストゥルメンタルかどうか */
  instrumental?: boolean
  /** モデルバージョン（デフォルト: v4） */
  model?: 'v3.5' | 'v4' | 'v4.5'
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
// API Response Types
// ============================================

interface SunoApiGenerateResponse {
  task_id: string
  status: string
}

interface SunoApiStatusResponse {
  task_id: string
  status: string
  output?: {
    audio_url?: string
    video_url?: string
    duration?: number
  }
  error?: string
}

// ============================================
// Client Implementation
// ============================================

/**
 * Suno API のベース URL を取得
 */
function getBaseUrl(): string {
  return (
    (env as unknown as Record<string, string | undefined>).SUNO_API_URL ??
    'https://api.sunoapi.org/v1'
  )
}

/**
 * Suno API キーを取得
 */
function getApiKey(): string {
  const apiKey = (env as unknown as Record<string, string | undefined>)
    .SUNO_API_KEY
  if (!apiKey) {
    throw new Error('SUNO_API_KEY is not configured')
  }
  return apiKey
}

/**
 * 音楽生成をリクエスト
 *
 * カスタムモード（歌詞指定）で音楽を生成する。
 * 生成は非同期で行われ、タスクIDが返される。
 */
export async function generateMusic(
  options: SunoGenerateOptions,
): Promise<SunoGenerateResult> {
  const baseUrl = getBaseUrl()
  const apiKey = getApiKey()

  const response = await fetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      // Custom mode: provide lyrics directly
      custom_mode: true,
      prompt: options.prompt,
      tags: options.style,
      title: options.title,
      make_instrumental: options.instrumental ?? false,
      model: options.model ?? 'v4',
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Suno API error: ${response.status} - ${errorText}`)
  }

  const data = (await response.json()) as SunoApiGenerateResponse

  return {
    taskId: data.task_id,
    status: normalizeStatus(data.status),
  }
}

/**
 * タスクステータスを確認
 *
 * 生成中のタスクの状態を確認し、完了時には音楽URLを返す。
 */
export async function checkMusicStatus(
  taskId: string,
): Promise<SunoGenerateResult> {
  const baseUrl = getBaseUrl()
  const apiKey = getApiKey()

  const response = await fetch(`${baseUrl}/task/${taskId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Suno API error: ${response.status} - ${errorText}`)
  }

  const data = (await response.json()) as SunoApiStatusResponse

  return {
    taskId: data.task_id,
    status: normalizeStatus(data.status),
    audioUrl: data.output?.audio_url,
    videoUrl: data.output?.video_url,
    errorMessage: data.error,
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
      // Unknown status, treat as processing
      return 'processing'
  }
}

/**
 * Suno API が設定されているかどうかを確認
 */
export function isSunoConfigured(): boolean {
  const apiKey = (env as unknown as Record<string, string | undefined>)
    .SUNO_API_KEY
  return !!apiKey
}
