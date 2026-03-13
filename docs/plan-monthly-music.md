# 月間日記音楽生成機能 - 実装計画

## 概要

日記エントリから月間振り返り音楽を生成する機能。ユーザーが1ヶ月分の日記を書き続けると、その内容から感情やテーマを抽出し、オリジナルの音楽を生成する。育児日記、仕事日記など、どんなコンテキストでも「今月のBGM」として振り返りに使える。

## ユーザーストーリー

1. ユーザーが `/diary music` コマンドを実行
2. 先月の日記エントリを収集・分析
3. Geminiで歌詞とSunoプロンプトを生成
4. Suno APIで音楽を生成（非同期）
5. 完成したらユーザーにDMで通知

## アーキテクチャ

```
┌─────────────┐     ┌───────────────┐     ┌──────────────┐
│ Slash Cmd  │────▶│ Gemini AI     │────▶│ Suno API     │
│ /diary music│     │ 歌詞生成       │     │ 音楽生成      │
└─────────────┘     └───────────────┘     └──────────────┘
                            │                     │
                            ▼                     ▼
                    ┌───────────────┐     ┌──────────────┐
                    │ DB: music     │     │ Slack DM     │
                    │ generations   │     │ 完了通知      │
                    └───────────────┘     └──────────────┘
```

## 実装タスク

### Phase 1: データベース

#### 1.1 マイグレーション作成

- ファイル: `migrations/0018_diary_music.sql`
- テーブル: `diaryMusicGenerations`

```sql
CREATE TABLE diary_music_generations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,

  -- 対象期間
  period_start TEXT NOT NULL,  -- YYYY-MM-DD
  period_end TEXT NOT NULL,    -- YYYY-MM-DD
  period_label TEXT NOT NULL,  -- "2026年2月" など

  -- 生成コンテンツ
  theme TEXT NOT NULL,         -- 抽出したテーマ
  mood_summary TEXT NOT NULL,  -- 感情の要約
  lyrics TEXT NOT NULL,        -- 生成した歌詞
  music_style TEXT NOT NULL,   -- Sunoプロンプト用スタイル
  music_title TEXT NOT NULL,   -- 曲タイトル

  -- Suno API連携
  suno_task_id TEXT,           -- Suno APIのタスクID
  suno_audio_url TEXT,         -- 生成された音楽URL
  suno_video_url TEXT,         -- (あれば) ビデオURL

  -- ステータス
  status TEXT NOT NULL DEFAULT 'pending',  -- pending/generating/completed/failed
  error_message TEXT,

  -- タイムスタンプ
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,

  -- インデックス用
  UNIQUE(user_id, period_label)
);

CREATE INDEX idx_diary_music_user ON diary_music_generations(user_id);
CREATE INDEX idx_diary_music_status ON diary_music_generations(status);
```

#### 1.2 TypeScript型定義

- ファイル: `app/services/db.ts` に追加

```typescript
interface DiaryMusicGeneration {
  id: string
  userId: string
  periodStart: string
  periodEnd: string
  periodLabel: string
  theme: string
  moodSummary: string
  lyrics: string
  musicStyle: string
  musicTitle: string
  sunoTaskId: string | null
  sunoAudioUrl: string | null
  sunoVideoUrl: string | null
  status: 'pending' | 'generating' | 'completed' | 'failed'
  errorMessage: string | null
  createdAt: string
  completedAt: string | null
}
```

### Phase 2: AI歌詞生成サービス

#### 2.1 歌詞生成

- ファイル: `app/services/ai/music-lyrics.ts`

```typescript
interface MusicLyricsOptions {
  userId: string
  periodLabel: string
  entries: DiaryEntryForMusic[]
  personality?: Personality | null
  characterInfo?: CharacterPersonaInfo | null
}

interface MusicLyricsResult {
  title: string // 曲タイトル
  theme: string // テーマ（30文字以内）
  moodSummary: string // 感情の要約（100文字以内）
  lyrics: string // 歌詞（日本語、4〜8行程度）
  musicStyle: string // Sunoプロンプト用スタイル（英語）
}

export async function generateMusicLyrics(
  options: MusicLyricsOptions,
): Promise<MusicLyricsResult>
```

**プロンプト設計:**

```
## タスク
ユーザーの1ヶ月分の日記から、振り返り用のオリジナル曲を作成する。

## 入力
- 期間: {periodLabel}
- 日記エントリ数: {count}件
- 主な出来事とキーワード

## 出力フォーマット
JSON形式で以下を返す:
- title: 曲タイトル（日本語、キャッチーで短い）
- theme: その月を象徴するテーマ（30文字以内）
- moodSummary: 感情の流れの要約（100文字以内）
- lyrics: 歌詞（日本語、4〜8行、韻を意識）
- musicStyle: 音楽スタイル（英語、Suno向け）

## 音楽スタイルの例
- "japanese pop, warm acoustic, nostalgic"
- "lo-fi hip hop, chill, reflective"
- "indie folk, gentle vocals, diary mood"
```

### Phase 3: Suno API連携

#### 3.1 Suno APIクライアント

- ファイル: `app/services/suno-api.ts`

```typescript
interface SunoGenerateOptions {
  prompt: string // 歌詞
  style: string // 音楽スタイル
  title: string // 曲タイトル
  instrumental?: boolean
}

interface SunoGenerateResult {
  taskId: string
  status: 'queued' | 'processing' | 'completed' | 'failed'
  audioUrl?: string
  videoUrl?: string
}

// 音楽生成をリクエスト
export async function generateMusic(
  options: SunoGenerateOptions,
): Promise<SunoGenerateResult>

// タスクステータスを確認
export async function checkMusicStatus(
  taskId: string,
): Promise<SunoGenerateResult>
```

**環境変数:**

- `SUNO_API_KEY`: Suno API（またはサードパーティプロバイダ）のAPIキー
- `SUNO_API_URL`: APIエンドポイント（デフォルト: `https://api.sunoapi.org/v1`）

### Phase 4: Slackハンドラ

#### 4.1 スラッシュコマンド拡張

- ファイル: `app/slack-app/handlers/diary/slash-command.ts` に `music` サブコマンド追加

```typescript
case 'music':
  return await handleMusicCommand(userId, args.slice(1), context)
```

#### 4.2 音楽生成コマンドハンドラ

- ファイル: `app/slack-app/handlers/diary/music-command.ts`

```typescript
export async function handleMusicCommand(
  userId: string,
  args: string[],
  context: SlackAppContextWithOptionalRespond,
) {
  // サブコマンド: /diary music [generate|status|list]
  const action = args[0]?.toLowerCase() || 'generate'

  switch (action) {
    case 'generate':
      return await handleMusicGenerate(userId, args.slice(1), context)
    case 'status':
      return await handleMusicStatus(userId, context)
    case 'list':
      return await handleMusicList(userId, context)
    default:
      return await handleMusicHelp(context)
  }
}
```

**フロー:**

1. `generate`: 先月の日記を取得 → 歌詞生成 → Suno APIリクエスト → "生成開始しました"
2. `status`: 進行中の生成状況を確認
3. `list`: 過去に生成した曲の一覧

### Phase 5: 非同期処理と通知

#### 5.1 生成完了のポーリング

- Cloudflare Workers の `waitUntil` を使用
- 定期的にSuno APIをポーリング
- 完了時にSlack DMで通知

```typescript
context.cloudflare.ctx.waitUntil(
  pollMusicGeneration(userId, taskId, context.client),
)
```

#### 5.2 完了通知

```typescript
await client.chat.postMessage({
  channel: userId, // DM
  text:
    `🎵 *${periodLabel}の振り返りBGM完成！*\n\n` +
    `曲名: ${title}\n` +
    `テーマ: ${theme}\n\n` +
    `${audioUrl}\n\n` +
    `今月も日記を書いてくれてありがとう。この曲と一緒に振り返ってみてね。`,
})
```

### Phase 6: 統合テスト

#### 6.1 ユニットテスト

- `app/services/ai/music-lyrics.test.ts` - 歌詞生成のモックテスト
- `app/services/suno-api.test.ts` - Suno API連携のモックテスト

#### 6.2 インテグレーションテスト

- `app/slack-app/handlers/diary/music-command.integration.test.ts`

## ファイル構成

```
app/
├── services/
│   ├── ai/
│   │   └── music-lyrics.ts          # 歌詞生成AI
│   ├── suno-api.ts                   # Suno API連携
│   └── diary-music.ts                # 音楽生成ビジネスロジック
└── slack-app/
    └── handlers/
        └── diary/
            ├── slash-command.ts      # musicサブコマンド追加
            └── music-command.ts      # 音楽コマンドハンドラ

migrations/
└── 0018_diary_music.sql              # DBスキーマ
```

## 環境変数

```
SUNO_API_KEY=your-api-key
SUNO_API_URL=https://api.sunoapi.org/v1  # オプション
```

## 今後の拡張案

1. **月次自動生成**: 毎月1日に前月の曲を自動生成
2. **カスタムスタイル**: ユーザーが好みの音楽ジャンルを設定可能
3. **シェア機能**: 生成した曲をSlackチャンネルでシェア
4. **歌詞表示**: Web UIで歌詞と音楽を同時に表示
5. **年間まとめ**: 12曲を集めた年間アルバム風の振り返り

## リスクと対策

| リスク             | 対策                                    |
| ------------------ | --------------------------------------- |
| Suno APIの応答遅延 | ポーリング間隔を調整、タイムアウト設定  |
| 日記が少なすぎる   | 最低エントリ数チェック（5件以上を推奨） |
| APIコスト          | 月1回までの生成制限、またはユーザー確認 |
| Suno API停止       | 歌詞のみ保存して再生成可能に            |

## 参考

- [Suno API Documentation](https://docs.sunoapi.org/)
- 既存実装: `app/services/ai/daily-reflection.ts`（類似パターン）
