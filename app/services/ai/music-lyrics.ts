/**
 * 日記から振り返り音楽用の歌詞とスタイルを生成するAIサービス
 *
 * 1ヶ月分の日記エントリからテーマと感情を抽出し、
 * Suno API用のプロンプト（歌詞＋スタイル）を生成する。
 */

import { z } from 'zod'
import { generateObject } from './genai'
import { type CharacterPersonaInfo, getPersonaBackgroundShort } from './persona'
import type { Personality } from './personality'

/**
 * 音楽生成用の日記エントリ情報
 */
export interface DiaryEntryForMusic {
  entryDate: string
  moodLabel: string | null
  moodEmoji: string | null
  detail: string | null
}

/**
 * 歌詞生成オプション
 */
export interface MusicLyricsOptions {
  userId: string
  periodLabel: string // "2026年2月" など
  entries: DiaryEntryForMusic[]
  personality?: Personality | null
  characterInfo?: CharacterPersonaInfo | null
}

/**
 * 生成結果
 */
export interface MusicLyricsResult {
  title: string // 曲タイトル
  theme: string // テーマ（30文字以内）
  moodSummary: string // 感情の要約（100文字以内）
  lyrics: string // 歌詞（日本語、4〜8行程度）
  musicStyle: string // Sunoプロンプト用スタイル（英語）
}

// Zodスキーマ
const musicLyricsSchema = z.object({
  title: z.string().describe('曲タイトル。日本語でキャッチーに、10文字以内'),
  theme: z.string().describe('その月を象徴するテーマ。30文字以内'),
  moodSummary: z.string().describe('感情の流れの要約。100文字以内'),
  lyrics: z.string().describe('歌詞。日本語で4〜8行。韻を意識する'),
  musicStyle: z
    .string()
    .describe(
      '音楽スタイル。英語でSuno向け。例: "japanese pop, warm acoustic, nostalgic"',
    ),
})

/**
 * 日記エントリから音楽用の歌詞とスタイルを生成
 */
export async function generateMusicLyrics(
  options: MusicLyricsOptions,
): Promise<MusicLyricsResult> {
  const { periodLabel, entries, personality, characterInfo } = options

  // ペルソナの説明（短縮版を使用）
  const personaName = characterInfo?.name ?? '日記アシスタント'
  const personaPrompt = getPersonaBackgroundShort(personaName)

  // 日記エントリを要約用テキストに変換
  const entrySummaries = entries
    .map((entry) => {
      const mood = entry.moodLabel
        ? `${entry.moodEmoji ?? ''} ${entry.moodLabel}`.trim()
        : ''
      const detail = entry.detail?.slice(0, 200) ?? ''
      return `【${entry.entryDate}】${mood ? ` (${mood})` : ''}\n${detail}`
    })
    .join('\n\n')

  // パーソナリティコンテキスト
  const personalityContext = personality
    ? `
## ユーザーの個性
${personality.summary}
特徴: ${personality.traits.join('、')}
興味: ${personality.interests.join('、')}`
    : ''

  const systemPrompt = `${personaPrompt}

## タスク
ユーザーの1ヶ月分の日記から、振り返り用のオリジナル曲の素材を作成する。

${personalityContext}

## 歌詞の方針
- ユーザーの実際の体験や感情を反映する
- 具体的なエピソードより、感情の流れや気づきを大切にする
- 押し付けがましい励ましは避ける
- 余韻を残す表現を心がける

## 音楽スタイルの選び方
日記の雰囲気に合わせて選ぶ。例:
- 穏やかな日常: "japanese pop, warm acoustic, gentle vocals"
- 忙しくも充実: "upbeat j-pop, energetic, hopeful"
- 内省的な月: "lo-fi hip hop, chill, reflective, ambient"
- 感情の起伏: "indie folk, emotional, storytelling"
- 挑戦の月: "soft rock, determined, progressive"

## 出力
JSON形式で以下を返す:
- title: 曲タイトル（日本語、キャッチーで短い、10文字以内）
- theme: その月を象徴するテーマ（30文字以内）
- moodSummary: 感情の流れの要約（100文字以内）
- lyrics: 歌詞（日本語、4〜8行、韻を意識、改行で区切る）
- musicStyle: 音楽スタイル（英語、Suno API向け、カンマ区切り）`

  const userPrompt = `## 対象期間
${periodLabel}

## 日記エントリ（${entries.length}件）
${entrySummaries}

上記の日記から、振り返り用の曲を作成してください。`

  const { object } = await generateObject({
    model: 'gemini-3-flash-preview',
    schema: musicLyricsSchema,
    system: systemPrompt,
    prompt: userPrompt,
    thinkingLevel: 'medium',
  })

  return object
}
