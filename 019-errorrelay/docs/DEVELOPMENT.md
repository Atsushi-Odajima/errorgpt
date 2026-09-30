# DEVELOPMENT

## 前提
Node.js >= 22.13（`node:sqlite` は未使用。File storage）。npm 10。

## セットアップ
```bash
cd 019-errorrelay
npm install
npm run build          # core → server → mcp → companion → pwa
npm run typecheck
npm test               # vitest（packages/*/test, apps/*/test）
npm run test:e2e       # Playwright。webServer で vite preview(4173) と server(8787) を自動起動
```

## 構成
```
packages/core/src
  schema/      report.ts（zod schema, createReport）, validate.ts
  time/        timestamp.ts（tz 変換、display、手入力 parse）
  env/         environment.ts（browser/node capture, merge, lines）
  privacy/     scanner.ts, redact.ts, exif.ts
  ai/          provider.ts（AIProvider, NullProvider, OpenAICompatibleProvider, MockProvider, sanitizeVision）
  analysis/    errorText.ts, screenshot.ts
  repro/       builder.ts
  quality/     check.ts
  generate/    report.ts（short/detailed/developer/json/diagnostic × ja/en）
  pkg/         package.ts（buildPackage, zip, import, Zip Slip guard, SecretLeakError）
  history/     state.ts（状態遷移、revision）
  adapters/    types, base, openaiSupport, codexFeedback, githubIssue, generic, registry, defaultChannels
  submit/      submitter.ts（preview, confirmation token, idempotency）
  status/      openaiStatus.ts, knownIssues.ts
  followup/    followup.ts
  codex/       diagnostics.ts
  apierror/    parse.ts
packages/server/src
  storage.ts auth.ts signedUrl.ts rateLimit.ts logger.ts mime.ts service.ts app.ts mcp.ts config.ts bin.ts
packages/mcp/src      bin.ts（stdio）
apps/pwa/src          main.ts backend.ts redactor.ts i18n.ts styles.css
apps/companion/src    bin.ts server.ts platform.ts
tests/e2e             playwright.config.ts pwa.spec.ts screenshots.spec.ts fixtures.ts
config/               channels.json env.example
```

## 開発フロー
1. core を変更したら `npx tsc -b packages/core` → 依存 package が dist を参照。
2. PWA は `npm run dev -w apps/pwa`（vite dev, 5173）。サーバーモードで使う場合は `ERRORRELAY_CORS_ORIGINS=http://127.0.0.1:5173` を server に付ける。
3. 新しい報告先を追加: `config/channels.json` に entry 追加（kind: generic_webform / generic_email / github_issue …）。コード追加が必要なのは新 capability の実送信ロジックのみ。

## API 一覧（server）
| Method | Path | 説明 |
|---|---|---|
| GET | /api/health | 稼働・AI 有効・channels version |
| GET/POST | /api/reports | 一覧 / 作成 |
| GET/PATCH/DELETE | /api/reports/:id | 取得 / 更新 / 削除（blob も削除） |
| POST | /api/reports/:id/attachments | multipart upload（MIME/size/実行ファイル検査、EXIF 除去） |
| GET | /api/reports/:id/attachments/:att/url | signed URL（既定 300 秒） |
| PATCH/DELETE | /api/reports/:id/attachments/:att | included 切替 / 削除 |
| POST | /api/reports/:id/analyze | AI vision（consent 必須） |
| POST | /api/reports/:id/inferences/:field | 推測値の確認 |
| POST | /api/reports/:id/repro | 再現手順提案 |
| POST | /api/reports/:id/redact | text redaction |
| GET | /api/reports/:id/quality | チェックリスト |
| POST | /api/reports/:id/ready | ready へ遷移（不足があれば 400） |
| GET | /api/reports/:id/render?format=&lang= | テキスト生成 |
| GET | /api/reports/:id/channels | 適用可能な報告先と capability |
| POST | /api/reports/:id/preview | 送信 preview（confirmation token 発行） |
| POST | /api/reports/:id/submit | 実行（DIRECT のみ送信、idempotencyKey 必須） |
| POST | /api/reports/:id/mark-sent | 利用者が送信したと記録 |
| POST | /api/reports/:id/close | 完了 |
| GET | /api/reports/:id/export | ZIP package |
| POST | /api/reports/import | ZIP 取り込み |
| POST | /api/reports/:id/followups | follow-up 返信生成 |
| GET | /api/reports/:id/known-issues | status / GitHub 既知問題 |
| POST | /api/tools/scan, /api/tools/codex-doctor-redact, /api/tools/api-error | 補助ツール |
| GET | /api/tools/channels | channels config |
| ALL | /mcp | MCP streamable HTTP（bearer） |
| GET | /api/blobs/:id?exp&sig&t | signed download（deleted report は 404） |

すべての state-changing リクエストは `Authorization: Bearer` と `X-ErrorRelay-Client: 1` が必要。
