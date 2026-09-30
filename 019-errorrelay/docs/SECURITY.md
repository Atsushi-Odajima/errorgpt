# SECURITY

## 実装済み
| 項目 | 実装 |
|---|---|
| Tenant 分離 | bearer token → Principal(tenantId)。Storage は tenant ごとのディレクトリ/キー。別 tenant の report は 404（テスト 19） |
| Server-side auth | token は SHA-256 ハッシュで保持し constant-time 比較。本番は `ERRORRELAY_TOKENS` 必須 |
| CSRF | Cookie 不使用 + state-changing リクエストに `X-ErrorRelay-Client: 1` 必須。CORS は明示 origin のみ |
| Signed attachment URL | HMAC-SHA256、既定 300 秒、tenant/blobId/exp を署名。期限切れ・改ざん→403。削除済み report→404（テスト 20, 21） |
| Encryption at rest | blob を AES-256-GCM（`ERRORRELAY_BLOB_KEY`）。report JSON は基盤の disk 暗号化に依存（OPERATIONS 参照） |
| Secret scanning | 保存・export・log の各段階（PRIVACY_REDACTION） |
| Rate limit | tenant ごと 120 req/分（設定可）。超過は 429（load test で確認） |
| Schema validation | zod（API 入力、report 保存時、import 時、channels config） |
| XSS | PWA は DOM API のみ（innerHTML 不使用）。CSP: `default-src 'self'`、API は `default-src 'none'`。`X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` |
| Upload 検証 | MIME allowlist、画像 magic byte と宣言 MIME の一致、15 MB 上限、実行ファイル/アーカイブの拡張子・magic 拒否、report あたり 20 件 |
| Zip Slip | import 時に絶対パス・`..`・ドライブレター・バックスラッシュ・制御文字を拒否、entry 数/サイズ上限 |
| Logs | 構造化 JSON。body/errorText/screenshot/token キーは出力しない。string は redaction 済み |
| Secrets to client | AI API key、GitHub token、signing secret は server のみ。PWA には出さない |
| Companion | 127.0.0.1 バインド、token 必須、origin 制限、home/tmp 配下のファイルのみ、実行ファイル拒否、read-only コマンドの allowlist |
| 二重送信防止 | idempotencyKey + store。`unknown` 結果は同一 key で再送可能、`sent` は再送しない（テスト 16） |

## 既知の制限 / 運用で補うもの
- multi-tenant の物理分離は無い（同一プロセス）。高い分離が必要なら tenant ごとに deploy。
- File storage はバックアップ暗号化を基盤側で行う（OPERATIONS）。
- 依存パッケージの脆弱性: `npm audit` を CI で実行（現時点で dev 依存に advisories あり、runtime には無い ― release 前に再確認）。
- Playwright/E2E は Chromium のみ。Safari/Firefox の実機確認は未実施。

## 報告
脆弱性は公開 Issue ではなく運用者の security 窓口へ（購入者向け「注意事項.txt」に記載）。
