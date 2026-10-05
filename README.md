# Angelic Angel (TypeScript)

[Angelic Angel](https://github.com/sh1ma/Angelic-Angel) の TypeScript 実装です。

Mozilla AutoPush に接続して Twitter/X の通知を受信・復号し、Webhook に転送します。
暗号処理（ECDH、HKDF、AES-128-GCM）は **Web Crypto API (`crypto.subtle`)** のみで実装されており、オリジナル版と同じ `angelic-angel.toml` 設定ファイルと完全な互換性があります。

詳細な設計書は [docs/typescript-port-design.md](docs/typescript-port-design.md) をご覧ください。

## 必要要件

- Node.js ≥ 22（推奨: 24 LTS）

## セットアップ & ビルド

```sh
cd ts
npm install
npm run build
```

`dist/cli.js` に CLI バンドルが生成されます。

## テスト

```sh
# 単体テスト・結合テスト・E2Eテストを実行 (50 tests)
npm test

# 型チェック (Web標準のみの core 層検証)
npm run typecheck:core

# プロジェクト全体の型チェック
npm run typecheck
```

## 使い方

```sh
# ヘルプ表示
node dist/cli.js --help

# 初期化 (Twitter Cookie 設定)
node dist/cli.js init

# プッシュ購読登録
node dist/cli.js register

# 通知の受信開始
WEBHOOK_ENDPOINT=https://your-webhook.example.com/endpoint node dist/cli.js listen

# 登録状況の確認
node dist/cli.js status

# 登録解除
node dist/cli.js unregister
```

グローバルインストールまたは npm link して `angelic-angel` コマンドとして使用することも可能です:

```sh
npm link
angelic-angel status
```
