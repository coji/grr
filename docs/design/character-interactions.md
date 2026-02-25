# キャラクター間交流システム設計

## 概要

同じSlackワークスペース内のキャラクター同士が交流し、ユーザー（主）同士の間接的なつながりを生み出す機能。

## コアバリュー

1. **偶然性** - いつ、誰と、何が起きるかは予測できない
2. **間接性** - ユーザー同士の直接のやりとりではなく、キャラを介した気配の共有
3. **プライバシー** - 日記の内容や個人情報は絶対に漏らさない
4. **飽きない** - 毎日ではなく、適度な頻度で特別感を維持

---

## プライバシーガードレール

### 絶対に共有しないもの（NEVER）

| カテゴリ | 詳細 |
|---------|------|
| 日記の内容 | テキスト、添付ファイル、具体的な出来事 |
| 気分の詳細 | 「落ち込んでいる」「怒っている」などの具体的な感情 |
| アクティビティ時刻 | いつ日記を書いたか、いつアクティブだったか |
| 日記の頻度 | 何日書いていない、などの情報 |
| ユーザーの個人情報 | 名前以外のプロフィール情報 |

### 共有してもよいもの（ALLOWED）

| カテゴリ | 詳細 | 例 |
|---------|------|-----|
| キャラの様子 | キャラ自身の状態として抽象化 | 「今日は元気いっぱいだった」 |
| キャラの好み | キャラの性格に基づく話 | 「お昼寝が好きなんだって」 |
| 一般的な話題 | 天気、季節、架空の冒険 | 「一緒に虹を見たよ」 |
| ポジティブな雰囲気 | 良いことのみ、かつ曖昧に | 「なんだか嬉しそうだった」 |

### 技術的ガードレール

```typescript
// AIプロンプトに必ず含める制約
const PRIVACY_CONSTRAINTS = `
## 絶対に守るルール
- ユーザーの日記内容には一切言及しない
- 「最近忙しそう」「落ち込んでる」などユーザーの状態を推測する発言はしない
- 具体的な時刻や日付に言及しない
- キャラクター自身の冒険や気持ちとして語る
`;
```

### オプトアウト機能

- ユーザー設定で「キャラの交流を許可」をON/OFF可能
- OFFの場合、そのキャラは他のキャラと遭遇しない
- デフォルトはON（ただし初回説明あり）

---

## 機能1: ふらっとおでかけ

### 概要

キャラが時々「おでかけ」して、同じワークスペースの他のキャラと偶然出会う。

### フロー

```
1. トリガー（1日1-2回、ランダムなタイミング）
2. 遭遇相手の選択（同じワークスペース内、交流許可のキャラから）
3. エピソード生成（AI）
4. 両方のユーザーに通知（次回ホームタブ表示時）
```

### 遭遇確率の設計

```typescript
// 基本確率: 1日あたり30%
// 修正要素:
// - 両方のユーザーが過去24時間以内にアクティブ: +20%
// - 過去に遭遇したことがある: +10%
// - キャラの相性（種族の組み合わせ）: +5%〜+15%
```

### エピソード生成

```typescript
const ENCOUNTER_PROMPT = `
あなたは2匹のキャラクターが偶然出会った場面を描写します。

## キャラクターA
名前: {characterA.name}
種族: {characterA.species}
性格: {characterA.personality}
口癖: {characterA.catchphrase}

## キャラクターB
名前: {characterB.name}
種族: {characterB.species}
性格: {characterB.personality}
口癖: {characterB.catchphrase}

## 出力形式
- 2-3文の短いエピソード
- 両方のキャラの特徴が出る描写
- 具体的で可愛らしい場面
- ユーザーの情報には一切言及しない

## 例
「ぽぽは散歩の途中で、木陰でお昼寝しているもこを見つけた。そっと近づいたら、もこが『むにゃ...おはよ』と目を開けた。二匹で雲の形当てっこをして遊んだよ。」
`;
```

### データモデル

```sql
-- ワークスペース追跡（既存テーブルの拡張）
ALTER TABLE user_characters ADD COLUMN workspace_id TEXT;
ALTER TABLE user_characters ADD COLUMN interaction_enabled BOOLEAN DEFAULT TRUE;

-- 遭遇ログ
CREATE TABLE character_encounters (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  character_a_user_id TEXT NOT NULL,
  character_b_user_id TEXT NOT NULL,
  encounter_type TEXT NOT NULL, -- 'random_meeting' | 'adventure' | 'gift'
  episode_text TEXT NOT NULL,
  episode_for_a TEXT, -- A視点の追加描写（オプション）
  episode_for_b TEXT, -- B視点の追加描写（オプション）
  read_by_a BOOLEAN DEFAULT FALSE,
  read_by_b BOOLEAN DEFAULT FALSE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### UI表示

ホームタブに「最近のできごと」セクションを追加：

```
┌─────────────────────────────────┐
│ 🌟 最近のできごと              │
├─────────────────────────────────┤
│ 昨日                           │
│ もこちゃんに会ったよ！         │
│ 一緒に光る石を探したの。       │
│ もこちゃん、石を見つけるの     │
│ 上手だったよ。                 │
└─────────────────────────────────┘
```

---

## 機能2: グループ冒険

### 概要

週に1回、ワークスペース内の複数のキャラが集まって冒険する。

### フロー

```
1. 毎週月曜日の朝にトリガー
2. 参加キャラの選択（交流許可のキャラ全員、最大5匹）
3. 冒険テーマの選択（ランダム）
4. 冒険エピソード生成（AI）
5. 各キャラの役割/ハイライト生成
6. 全員に通知
```

### 冒険テーマ例

```typescript
const ADVENTURE_THEMES = [
  { id: 'crystal_cave', name: '光る洞窟探検', emoji: '💎' },
  { id: 'cloud_journey', name: '雲の上の旅', emoji: '☁️' },
  { id: 'forest_picnic', name: '森のピクニック', emoji: '🌲' },
  { id: 'stargazing', name: '星空観察会', emoji: '🌟' },
  { id: 'rainbow_chase', name: '虹を追いかけて', emoji: '🌈' },
  { id: 'treasure_hunt', name: '宝探しゲーム', emoji: '🗺️' },
  { id: 'cooking_party', name: 'みんなでお料理', emoji: '🍳' },
  { id: 'music_festival', name: '音楽会', emoji: '🎵' },
];
```

### 各キャラの役割

性格に基づいて自動的に役割が決まる：

```typescript
const ADVENTURE_ROLES = [
  'リーダー（先頭を歩いた）',
  '発見者（珍しいものを見つけた）',
  'ムードメーカー（みんなを笑わせた）',
  'サポーター（困っている子を助けた）',
  '記録係（思い出を絵に描いた）',
];
```

### データモデル

```sql
CREATE TABLE character_adventures (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  theme_id TEXT NOT NULL,
  theme_name TEXT NOT NULL,
  theme_emoji TEXT NOT NULL,
  main_episode TEXT NOT NULL,
  participant_count INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE character_adventure_participants (
  id TEXT PRIMARY KEY,
  adventure_id TEXT NOT NULL REFERENCES character_adventures(id),
  character_user_id TEXT NOT NULL,
  role_text TEXT NOT NULL,
  highlight_text TEXT NOT NULL,
  read BOOLEAN DEFAULT FALSE,
  UNIQUE(adventure_id, character_user_id)
);
```

---

## 機能3: おすそわけ

### 概要

キャラが「アイテム」を見つけ、他のキャラにプレゼントできる。

### アイテムの種類

```typescript
const ITEM_CATEGORIES = [
  {
    category: 'nature',
    items: [
      { id: 'shiny_stone', name: '光る石', emoji: '💎' },
      { id: 'four_leaf', name: '四つ葉のクローバー', emoji: '🍀' },
      { id: 'pretty_shell', name: 'きれいな貝殻', emoji: '🐚' },
      { id: 'feather', name: 'ふわふわの羽', emoji: '🪶' },
    ]
  },
  {
    category: 'food',
    items: [
      { id: 'candy', name: 'あめちゃん', emoji: '🍬' },
      { id: 'cookie', name: '手作りクッキー', emoji: '🍪' },
      { id: 'fruit', name: '甘い木の実', emoji: '🫐' },
    ]
  },
  {
    category: 'craft',
    items: [
      { id: 'bracelet', name: '手編みのミサンガ', emoji: '🧶' },
      { id: 'drawing', name: 'お絵かき', emoji: '🖼️' },
      { id: 'origami', name: '折り紙', emoji: '📄' },
    ]
  },
];
```

### フロー

```
1. キャラがアイテムを「見つける」（ランダム、1日1回程度）
2. ユーザーに報告「○○見つけたよ！」
3. ユーザーが「誰かにあげる」を選択可能
4. 相手を選択（同じワークスペースのキャラ一覧）
5. キャラが届けに行く
6. 相手に通知「○○からもらったよ！」
```

### データモデル

```sql
CREATE TABLE character_items (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  item_name TEXT NOT NULL,
  item_emoji TEXT NOT NULL,
  item_description TEXT,
  found_at TEXT DEFAULT CURRENT_TIMESTAMP,
  received_from_user_id TEXT, -- NULLなら自分で見つけた
  gifted_to_user_id TEXT,     -- NULLならまだ持っている
  gifted_at TEXT
);
```

### UI

```
┌─────────────────────────────────┐
│ 🎁 もちもの (3)                │
├─────────────────────────────────┤
│ 💎 光る石                      │
│    もこちゃんからもらった      │
│                                │
│ 🍀 四つ葉のクローバー          │
│    散歩中に見つけた            │
│                   [あげる ▼]   │
└─────────────────────────────────┘
```

---

## スケジュール設計

| イベント | 頻度 | トリガー |
|---------|------|----------|
| ふらっとおでかけ | 1日0-2回 | Cron (ランダム時刻) |
| グループ冒険 | 週1回 | Cron (月曜 9:00 JST) |
| アイテム発見 | 1日0-1回 | ユーザーアクション時 |

---

## 実装フェーズ

### Phase 1: 基盤整備
- [ ] workspace_id の追跡開始
- [ ] 交流設定のUI追加
- [ ] プライバシーガードレールのテスト作成

### Phase 2: ふらっとおでかけ
- [ ] character_encounters テーブル作成
- [ ] 遭遇判定ロジック
- [ ] エピソード生成AI
- [ ] ホームタブUI

### Phase 3: グループ冒険
- [ ] character_adventures テーブル作成
- [ ] 週次Cronジョブ
- [ ] 冒険生成AI
- [ ] 通知UI

### Phase 4: おすそわけ
- [ ] character_items テーブル作成
- [ ] アイテム発見ロジック
- [ ] ギフトUI
- [ ] 受け取り通知

---

## 将来の拡張案

1. **なかよし度** - 同じキャラとの遭遇回数で特別なイベント解禁
2. **キャラ図鑑** - ワークスペース内のキャラを見られる（オプトイン）
3. **お手紙** - キャラ経由でメッセージを送る
4. **季節イベント** - クリスマス、お正月などの特別冒険
