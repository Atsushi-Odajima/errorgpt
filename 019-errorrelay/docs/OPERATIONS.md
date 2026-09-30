# OPERATIONS

## デプロイ（単一ノード）
1. Node 22 をインストール。`npm ci && npm run build`。
2. `config/env.example` を元に環境変数を設定（`ERRORRELAY_TOKENS`, `ERRORRELAY_SIGNING_SECRET`, `ERRORRELAY_BLOB_KEY`, `ERRORRELAY_DATA_DIR`, `ERRORRELAY_PWA_DIR=./apps/pwa/dist`）。
3. `node packages/server/dist/bin.js` を systemd / PM2 / コンテナで常駐。前段に TLS 終端（Caddy / nginx / Cloudflare）。
4. PWA は同一オリジンで配信（CSP と CORS が最小になる）。別オリジンなら `ERRORRELAY_CORS_ORIGINS`。
5. MCP は `https://<host>/mcp`。ChatGPT Plugin 登録時はこの URL と OAuth（将来）を設定。現状は bearer token（個人/小規模向け）。

### Dockerfile（例）
```Dockerfile
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm ci && npm run build
ENV NODE_ENV=production PORT=8787 ERRORRELAY_PWA_DIR=/app/apps/pwa/dist ERRORRELAY_DATA_DIR=/data
VOLUME /data
CMD ["node","packages/server/dist/bin.js"]
```

## データ
- 保存先: `ERRORRELAY_DATA_DIR/tenants/<tenant>/{reports,blobs,idempotency}`。
- Retention: `ERRORRELAY_RETENTION_DAYS`（既定 30）。1 時間ごとに updatedAt が期限を過ぎた report と blob を hard delete。
- 削除: API DELETE で report + blob を即時削除。バックアップからの削除はバックアップ側のローテーション（推奨 ≤ 7 日）に依存することを利用者に明示（PRIVACY.md）。
- 保存しないモード: `ERRORRELAY_NO_SAVE=1`（メモリのみ。再起動で消える）。PWA ローカルモードはサーバーに一切送らない。
- バックアップ: data dir を暗号化した状態でスナップショット。`ERRORRELAY_BLOB_KEY` は別管理（KMS/secret manager）。

## 監視
- `/api/health`。ログは JSON（stdout）。report 本文・画像・token は出力されない。
- ErrorRelay 自身の telemetry は無し（opt-in の crash 通知を将来追加する場合も report 内容と分離）。

## 更新
- 公式経路変更 → `config/channels.json` を編集（`verifiedAt`, `sourceUrls` を更新）→ 再起動。schema 変更不要。
- 依存更新 → `npm audit`、`npm test`、`npm run test:e2e`。
