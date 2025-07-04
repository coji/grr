# grr - Slackでイライラを記録・共有するアプリ

[![Built with React Router](https://img.shields.io/badge/Built%20with-React%20Router-7d32e1)](https://reactrouter.com)
[![Powered by Cloudflare](https://img.shields.io/badge/Powered%20by-Cloudflare-f38020)](https://workers.cloudflare.com/)
[![Styled with Tailwind CSS](https://img.shields.io/badge/Styled%20with-Tailwind%20CSS-38b2ac)](https://tailwindcss.com)

`grr` は、日々のちょっとしたイライラを Slack 上で簡単に記録し、チームや仲間内で共有できる Web アプリケーションです。Cloudflare Workers 上で動作し、React Router と Vite を使用して構築されています。

## 主な機能

* **Slack から簡単記録:**
  * `/grr [イラっとしたこと]` スラッシュコマンドで記録。
  * 既存のメッセージからメッセージショートカットで記録。
* **イライラ度の設定:** 1〜5段階でイライラ度を設定できます。
* **記録の表示:** 記録されたイライラを一覧で確認できます (現在は基本的な表示のみ)。
* **Slack 通知:** 記録時に指定されたチャンネルまたはDMに通知します。

## 技術スタック

* **フレームワーク:** [React Router](https://reactrouter.com/) (v7)
* **UI:** [React](https://react.dev/) (v19), [Tailwind CSS](https://tailwindcss.com/) (v4)
* **ビルドツール:** [Vite](https://vitejs.dev/)
* **言語:** [TypeScript](https://www.typescriptlang.org/)
* **ランタイム:** [Cloudflare Workers](https://workers.cloudflare.com/)
* **データベース:** [Cloudflare D1](https://developers.cloudflare.com/d1/)
* **Slack連携:** [slack-cloudflare-workers](https://github.com/slackapi/slack-cloudflare-workers), [slack-edge](https://github.com/slackapi/slack-edge)
* **パッケージマネージャー:** [pnpm](https://pnpm.io/)
* **リンター/フォーマッター:** [Biome](https://biomejs.dev/)

## 前提条件

* [Node.js](https://nodejs.org/) (v20 以降推奨)
* [pnpm](https://pnpm.io/installation)
* [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) (Cloudflare アカウントが必要です)
* [Slack アプリケーション](https://api.slack.com/apps) の作成権限

## セットアップ手順

1. **リポジトリのクローン:**

    ```bash
    git clone https://github.com/coji/grr.git
    cd grr
    ```

2. **依存関係のインストール:**

    ```bash
    pnpm install
    ```

3. **Cloudflare D1 データベースの準備:**
    * D1 データベースを作成します (初回のみ)。

        ```bash
        # wrangler.jsonc の database_name を確認して実行
        wrangler d1 create grr-db
        ```

    * 作成されたデータベースの `database_id` を `wrangler.jsonc` の `d1_databases` セクションに設定します。
    * マイグレーションを実行してテーブルを作成します。

        ```bash
        wrangler d1 migration apply grr-db
        ```

4. **Slack アプリの作成と設定:**
    * [Slack App Manifest](./slack-app-manifest.example.json) を参考に、Slack アプリケーションを作成します。
        * [api.slack.com](https://api.slack.com/apps?new_app=1) にアクセスし、「From an app manifest」を選択。
        * ワークスペースを選択し、マニフェストの内容を YAML または JSON 形式で貼り付けます。
        * **重要:** マニフェスト内の `request_url` (`https://example.com/webhook/slack`) は、後でデプロイする Cloudflare Worker の URL に置き換える必要があります。まずは仮のURLで作成し、デプロイ後に更新してください。
    * アプリをワークスペースにインストールします。
    * インストール後、以下の情報を取得します。
        * **Bot User OAuth Token:** (`xoxb-...`)
        * **Signing Secret:**

5. **環境変数の設定:**
    * プロジェクトルートに `.dev.vars` ファイルを作成します。
    * 以下の内容を記述し、取得した Slack の情報を設定します。

        ```ini
        # .dev.vars

        # Slack App Settings
        SLACK_SIGNING_SECRET="YOUR_SLACK_SIGNING_SECRET"
        SLACK_BOT_TOKEN="xoxb-YOUR_SLACK_BOT_TOKEN"
        SLACK_LOGGING_LEVEL="INFO" # 必要に応じて DEBUG, WARN, ERROR に変更

        # Cloudflare D1 Binding (wrangler.jsonc で設定済みの場合は不要なことが多い)
        # DB= # D1 バインディングは wrangler.toml/.dev.vars で直接設定される

        # その他の環境変数があればここに追加
        ```

    * **注意:** `.dev.vars` は Git の管理対象外です (`.gitignore` を確認)。

6. **型定義の生成:**

    ```bash
    pnpm typecheck
    ```

## 開発

ローカル開発サーバーを起動します。HMR (Hot Module Replacement) が有効になります。

```bash
pnpm dev
```

アプリケーションは `http://localhost:5173` で利用可能になります。Cloudflare のリソース (D1 など) も `wrangler dev` によってエミュレートされます。

## ビルド

本番用のビルドを作成します。

```bash
pnpm run build
```

ビルドされたアセットは `build/` ディレクトリに出力されます。

## デプロイ

アプリケーションを Cloudflare Workers にデプロイします。

```bash
pnpm deploy
```

デプロイが成功すると、Worker の URL が表示されます。この URL を Slack アプリの設定 (Request URL, Interactivity Request URL など) に反映させてください。

## リンティングとフォーマット

[Biome](https://biomejs.dev/) を使用してコードのチェックとフォーマットを行います。

```bash
# チェックのみ
pnpm biome check .

# チェックして修正を適用
pnpm biome check --apply .

# フォーマット
pnpm biome format --write .
```

---

Built with ❤️ using React Router.
