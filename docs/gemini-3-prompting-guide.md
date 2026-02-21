# Gemini 3 Flash プロンプトガイド

このドキュメントは、Gemini 3 Flash向けにAIプロンプトを設計する際のベストプラクティスをまとめたものです。

## 参照元

- [Gemini 3 prompting guide | Google Cloud](https://cloud.google.com/vertex-ai/generative-ai/docs/start/gemini-3-prompting-guide)
- [Prompt design strategies | Gemini API](https://ai.google.dev/gemini-api/docs/prompting-strategies)

---

## 基本原則

### 1. 簡潔で直接的に

Gemini 3は**reasoning model**です。冗長なプロンプトエンジニアリングは逆効果になることがあります。

```typescript
// Good: 簡潔
## タスク
日記を書いた相手に寄り添って返信する。

// Bad: 冗長
## 今回のタスク
あなたはSlackで日記を書いた相手に対して、温かく寄り添いながら、
共感を込めた返信を生成してください。その際、相手の気持ちを...
```

### 2. 一貫した構造を使用する

XMLタグまたはMarkdown見出しのどちらかに統一し、混在させない。

```typescript
// 推奨フォーマット
## タスク
[具体的な指示]

## 入力
[コンテキスト情報]

## 出力フォーマット
[制約と要件]

## 例
[良い例のみ]
```

### 3. 否定的制約を避ける

「〜するな」より「〜する」の形式で指示する。

```typescript
// Good: 肯定形
- 受け止めた言葉で返す
- 寄り添いと共感を示す
- 2-3文で完結させる

// Bad: 否定形が多い
- 追い質問は行わない
- 説教や助言は避ける
- 長すぎる文章を避ける
```

### 4. 出力フォーマットを明示する

```typescript
## 出力フォーマット
- 形式: 日本語の散文（改行なし）
- 長さ: 2-3文、120文字以内
- トーン: 温かく受容的
```

---

## thinkingLevel の使い分け

| レベル    | 用途                   | 例                                 |
| --------- | ---------------------- | ---------------------------------- |
| `minimal` | 単純な分類・抽出タスク | 意図分類、メモリ抽出               |
| `low`     | 要約・フォローアップ   | 週次ダイジェスト、気遣いメッセージ |
| `medium`  | 深い理解が必要なタスク | 日記返信、振り返り生成             |

```typescript
providerOptions: {
  google: {
    thinkingConfig: { thinkingLevel: 'minimal' }, // または 'low', 'medium'
  } satisfies GoogleGenerativeAIProviderOptions,
}
```

---

## ペルソナの使い分け

プロジェクトでは2種類のペルソナを用意しています。

### 簡潔版 (`getPersonaBackgroundShort`)

単純なタスク向け。トークン効率を重視。

- フォローアップメッセージ
- マイルストーン祝福
- 季節の挨拶
- ランダムチェックイン
- 意図分類

### 標準版 (`getPersonaBackground`)

深い理解が必要なタスク向け。

- 日記返信
- 振り返り生成
- パーソナリティ生成

---

## プロンプト設計のチェックリスト

1. [ ] プロンプトは簡潔か？（不要な説明を削除）
2. [ ] 構造は一貫しているか？（## タスク / ## 出力フォーマット など）
3. [ ] 否定的制約を肯定形に置き換えたか？
4. [ ] 出力フォーマットを明示したか？
5. [ ] thinkingLevel はタスクの複雑さに適切か？
6. [ ] ペルソナは適切なバージョンを使用しているか？

---

## 温度設定

Gemini 3では**temperature: 1.0 (デフォルト)** を維持することが推奨されています。
明示的に設定する必要はありません。

---

## 更新履歴

- 2026-02-21: 初版作成（Gemini 3 Flash公式ガイドに基づく改善）
