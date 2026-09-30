# PROGRESS

## 2026-09-30
- Phase0: 公式経路調査。help.openai.com / developers.openai.com / status.openai.com は開発環境の egress でブロック → 検索スニペットと GitHub 一次資料で確認し SOURCE_NOTES.md に分類記録。
- core 実装（schema, timestamp, environment, privacy, exif, repro, analysis, quality, generate, package, history, adapters, submit, status, knownIssues, followup, codex, apierror）。unit tests 45。
- server（storage/auth/signedUrl/rateLimit/logger/mime/service/app/mcp/config/bin）+ MCP tools 12 種。tests 追加 → 62。
- PWA（local / server backend, canvas redactor, 3-step UI, history, settings, companion 連携）。
- Desktop Companion（serve/env/codex-version/codex-doctor/clipboard）。
- Playwright E2E 5 シナリオ × 3 端末（desktop 1280x800, iPhone 14, Pixel 7）= 15 pass。スクリーンショットを docs/screenshots に保存。
- API レベル E2E-2 (Codex), E2E-3 (API error), MCP over HTTP, load (200 並列 + rate limit) 追加。
- docs 一式、購入者向け資料、submission 資料作成。

## 未完了 / 未検証
- 実機（iPhone / Android / Windows / macOS）での動作確認。
- 実 AI provider（vision）での抽出精度。
- ChatGPT / Codex への Plugin 接続・提出。
- 本番デプロイ（HTTPS ドメイン、`/.well-known/openai-apps-challenge`）。
