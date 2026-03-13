/**
 * 日記音楽生成サービス
 *
 * 1ヶ月分の日記から振り返り用のオリジナル音楽を生成する。
 * AI で歌詞を生成し、Suno API で音楽を生成する。
 */

import { nanoid } from 'nanoid'
import dayjs from '~/lib/dayjs'
import { generateMusicLyrics, type DiaryEntryForMusic } from './ai/music-lyrics'
import type { CharacterPersonaInfo } from './ai/persona'
import type { Personality } from './ai/personality'
import { getCharacter } from './character'
import { db, type Database } from './db'
import { checkMusicStatus, generateMusic, isSunoConfigured } from './suno-api'

// ============================================
// Types
// ============================================

export type DiaryMusicGeneration = Database['diaryMusicGenerations']

export interface GenerateMusicOptions {
  userId: string
  /** 対象年月（省略時は先月） */
  targetMonth?: { year: number; month: number }
  /** ユーザーのパーソナリティ（省略時はDBから取得） */
  personality?: Personality | null
}

export interface GenerateMusicResult {
  generation: DiaryMusicGeneration
  isNew: boolean
  message: string
}

// ============================================
// Constants
// ============================================

const TOKYO_TZ = 'Asia/Tokyo'

/** 最低エントリ数（これ未満だと生成しない） */
export const MIN_ENTRIES_FOR_MUSIC = 3

// ============================================
// Music Generation
// ============================================

/**
 * 指定月の日記から音楽を生成
 */
export async function generateDiaryMusic(
  options: GenerateMusicOptions,
): Promise<GenerateMusicResult> {
  const { userId, targetMonth } = options

  // Suno API が設定されているか確認
  if (!isSunoConfigured()) {
    throw new Error('音楽生成サービスが設定されていません')
  }

  // 対象期間を計算（デフォルトは先月）
  const now = dayjs().tz(TOKYO_TZ)
  const targetDate = targetMonth
    ? dayjs()
        .tz(TOKYO_TZ)
        .year(targetMonth.year)
        .month(targetMonth.month - 1)
    : now.subtract(1, 'month')

  const periodStart = targetDate.startOf('month').format('YYYY-MM-DD')
  const periodEnd = targetDate.endOf('month').format('YYYY-MM-DD')
  const periodLabel = targetDate.format('YYYY年M月')

  // 既存の生成をチェック
  const existing = await getMusicGeneration(userId, periodLabel)
  if (existing) {
    if (existing.status === 'completed') {
      return {
        generation: existing,
        isNew: false,
        message: `${periodLabel}の曲はすでに生成済みです`,
      }
    }
    if (existing.status === 'generating' || existing.status === 'pending') {
      return {
        generation: existing,
        isNew: false,
        message: `${periodLabel}の曲は現在生成中です`,
      }
    }
    // failed の場合は再生成を許可
  }

  // 対象期間の日記エントリを取得
  const entries = await getDiaryEntriesForPeriod(userId, periodStart, periodEnd)

  if (entries.length < MIN_ENTRIES_FOR_MUSIC) {
    throw new Error(
      `日記が${MIN_ENTRIES_FOR_MUSIC}件以上必要です（現在${entries.length}件）`,
    )
  }

  // キャラクター情報を取得
  const character = await getCharacter(userId)
  const characterInfo: CharacterPersonaInfo | null = character
    ? {
        name: character.characterName,
        species: character.characterSpecies,
        personality: character.characterPersonality,
        catchphrase: character.characterCatchphrase,
      }
    : null

  // パーソナリティを取得
  let personality = options.personality
  if (personality === undefined) {
    const settings = await db
      .selectFrom('userDiarySettings')
      .select('personality')
      .where('userId', '=', userId)
      .executeTakeFirst()
    if (settings?.personality) {
      try {
        personality = JSON.parse(settings.personality) as Personality
      } catch {
        personality = null
      }
    } else {
      personality = null
    }
  }

  // AI で歌詞を生成
  const lyrics = await generateMusicLyrics({
    userId,
    periodLabel,
    entries,
    personality,
    characterInfo,
  })

  // DB にレコードを作成
  const generationId = nanoid()
  const nowUtc = dayjs().utc().toISOString()

  const generation: DiaryMusicGeneration = {
    id: generationId,
    userId,
    periodStart,
    periodEnd,
    periodLabel,
    theme: lyrics.theme,
    moodSummary: lyrics.moodSummary,
    lyrics: lyrics.lyrics,
    musicStyle: lyrics.musicStyle,
    musicTitle: lyrics.title,
    sunoTaskId: null,
    sunoAudioUrl: null,
    sunoVideoUrl: null,
    status: 'pending',
    errorMessage: null,
    createdAt: nowUtc,
    completedAt: null,
  }

  // 既存の failed レコードがあれば更新、なければ挿入
  if (existing?.status === 'failed') {
    await db
      .updateTable('diaryMusicGenerations')
      .set({
        theme: generation.theme,
        moodSummary: generation.moodSummary,
        lyrics: generation.lyrics,
        musicStyle: generation.musicStyle,
        musicTitle: generation.musicTitle,
        status: 'pending',
        errorMessage: null,
        sunoTaskId: null,
        sunoAudioUrl: null,
        sunoVideoUrl: null,
      })
      .where('id', '=', existing.id)
      .execute()
    generation.id = existing.id
  } else {
    await db.insertInto('diaryMusicGenerations').values(generation).execute()
  }

  // Suno API で音楽生成を開始
  try {
    const sunoResult = await generateMusic({
      prompt: lyrics.lyrics,
      style: lyrics.musicStyle,
      title: lyrics.title,
    })

    // タスク ID を保存
    await db
      .updateTable('diaryMusicGenerations')
      .set({
        sunoTaskId: sunoResult.taskId,
        status: 'generating',
      })
      .where('id', '=', generation.id)
      .execute()

    generation.sunoTaskId = sunoResult.taskId
    generation.status = 'generating'
  } catch (error) {
    // API エラー時は失敗として記録
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    await db
      .updateTable('diaryMusicGenerations')
      .set({
        status: 'failed',
        errorMessage,
      })
      .where('id', '=', generation.id)
      .execute()
    throw error
  }

  return {
    generation,
    isNew: true,
    message: `${periodLabel}の振り返りBGM生成を開始しました`,
  }
}

/**
 * 音楽生成ステータスを更新（ポーリング用）
 */
export async function updateMusicStatus(
  generationId: string,
): Promise<DiaryMusicGeneration | null> {
  const generation = await db
    .selectFrom('diaryMusicGenerations')
    .selectAll()
    .where('id', '=', generationId)
    .executeTakeFirst()

  if (!generation || !generation.sunoTaskId) {
    return generation ?? null
  }

  // すでに完了または失敗している場合はスキップ
  if (generation.status === 'completed' || generation.status === 'failed') {
    return generation
  }

  try {
    const sunoResult = await checkMusicStatus(generation.sunoTaskId)

    if (sunoResult.status === 'completed' && sunoResult.audioUrl) {
      // 完了
      await db
        .updateTable('diaryMusicGenerations')
        .set({
          status: 'completed',
          sunoAudioUrl: sunoResult.audioUrl,
          sunoVideoUrl: sunoResult.videoUrl ?? null,
          completedAt: dayjs().utc().toISOString(),
        })
        .where('id', '=', generationId)
        .execute()

      return {
        ...generation,
        status: 'completed',
        sunoAudioUrl: sunoResult.audioUrl,
        sunoVideoUrl: sunoResult.videoUrl ?? null,
        completedAt: dayjs().utc().toISOString(),
      }
    }

    if (sunoResult.status === 'failed') {
      // 失敗
      await db
        .updateTable('diaryMusicGenerations')
        .set({
          status: 'failed',
          errorMessage: sunoResult.errorMessage ?? 'Music generation failed',
        })
        .where('id', '=', generationId)
        .execute()

      return {
        ...generation,
        status: 'failed',
        errorMessage: sunoResult.errorMessage ?? 'Music generation failed',
      }
    }

    // まだ処理中
    return generation
  } catch (error) {
    console.error('Failed to check music status:', error)
    return generation
  }
}

// ============================================
// Query Functions
// ============================================

/**
 * 指定期間の音楽生成を取得
 */
export async function getMusicGeneration(
  userId: string,
  periodLabel: string,
): Promise<DiaryMusicGeneration | null> {
  const generation = await db
    .selectFrom('diaryMusicGenerations')
    .selectAll()
    .where('userId', '=', userId)
    .where('periodLabel', '=', periodLabel)
    .executeTakeFirst()

  return generation ?? null
}

/**
 * 進行中の音楽生成を取得
 */
export async function getPendingMusicGeneration(
  userId: string,
): Promise<DiaryMusicGeneration | null> {
  const generation = await db
    .selectFrom('diaryMusicGenerations')
    .selectAll()
    .where('userId', '=', userId)
    .where('status', 'in', ['pending', 'generating'])
    .orderBy('createdAt', 'desc')
    .limit(1)
    .executeTakeFirst()

  return generation ?? null
}

/**
 * ユーザーの音楽生成一覧を取得
 */
export async function getMusicGenerations(
  userId: string,
  limit = 12,
): Promise<DiaryMusicGeneration[]> {
  return await db
    .selectFrom('diaryMusicGenerations')
    .selectAll()
    .where('userId', '=', userId)
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .execute()
}

/**
 * すべての進行中の音楽生成を取得（バッチ処理用）
 */
export async function getAllPendingMusicGenerations(): Promise<
  DiaryMusicGeneration[]
> {
  return await db
    .selectFrom('diaryMusicGenerations')
    .selectAll()
    .where('status', 'in', ['pending', 'generating'])
    .execute()
}

// ============================================
// Helper Functions
// ============================================

/**
 * 指定期間の日記エントリを取得
 */
async function getDiaryEntriesForPeriod(
  userId: string,
  startDate: string,
  endDate: string,
): Promise<DiaryEntryForMusic[]> {
  const entries = await db
    .selectFrom('diaryEntries')
    .select(['entryDate', 'moodLabel', 'moodEmoji', 'detail'])
    .where('userId', '=', userId)
    .where('entryDate', '>=', startDate)
    .where('entryDate', '<=', endDate)
    .orderBy('entryDate', 'asc')
    .execute()

  return entries
}
