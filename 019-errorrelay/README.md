# ErrorRelay — AIエラー報告アシスタント（商品 #019）

> エラー画面を渡すだけ。スクショ・発生時刻・環境・再現手順を整理して、開発元へ伝わるバグ報告を作る。

| 構成要素 | パス | 役割 |
|---|---|---|
| Core | `packages/core` | 報告スキーマ、日時/環境、privacy scanner・redaction、再現手順ビルダー、レポート生成（ja/en）、ZIP パッケージ、Provider Adapter、送信確認・idempotency、status/既知障害、follow-up |
| Server | `packages/server` | REST API（Hono）、tenant 分離、signed URL、rate limit、暗号化 storage、retention、MCP tools |
| MCP Plugin | `packages/mcp` | stdio 起動（Codex CLI / ローカル MCP host 用）。HTTP は server の `/mcp` |
| PWA | `apps/pwa` | スクショ/テキスト/Codex から 3 step で報告作成。ローカルモード（サーバー不要）とサーバーモード |
| Desktop Companion | `apps/companion` | クリップボード画像・OS 情報・`codex --version` / `codex doctor --json`（マスク後）・ログ取り込み。ボタン操作時のみ動作 |
| Docs | `docs/` | 開発資料（37章）、購入者向け資料（`docs/buyer/`）、Plugin 提出資料（`docs/submission/`） |

## クイックスタート

```bash
cd 019-errorrelay
npm install
npm run build
npm test                      # 62 unit/integration tests
npm run test:e2e              # Playwright: desktop / iPhone 14 / Pixel 7 (要 build)

# サーバー + PWA（同一オリジン配信）
ERRORRELAY_TOKENS=mytoken:tenant1:me ERRORRELAY_PWA_DIR=./apps/pwa/dist node packages/server/dist/bin.js
# → http://127.0.0.1:8787  （PWA 設定で サーバーURL と token を入力）

# PWA だけ（ローカルモード、サーバー不要）
npm run preview -w apps/pwa   # http://127.0.0.1:4173

# Desktop Companion
node apps/companion/dist/bin.js serve --origin http://127.0.0.1:4173

# MCP (stdio)
ERRORRELAY_NO_SAVE=1 node packages/mcp/dist/bin.js
```

## 送信能力（2026-09-30 確認、`docs/SOURCE_NOTES.md`）

| 報告先 | capability | 理由 |
|---|---|---|
| OpenAI Support（help.openai.com） | INTERACTIVE_HANDOFF | チケット作成の公開 API が存在しない |
| Codex `/feedback` | INTERACTIVE_HANDOFF | Codex 内部のフローのため外部から呼べない |
| GitHub Issue（openai/codex） | INTERACTIVE_HANDOFF（既定）/ DIRECT（token 設定＋明示承認時のみ） | 公式テンプレート付き new-issue URL を生成 |
| メール / Web フォーム | INTERACTIVE_HANDOFF | 宛先は利用者・運用者が指定 |
| Export | EXPORT_ONLY | TXT / Markdown / JSON / ZIP |

「送信済み」は DIRECT 成功時の receipt を確認できた場合のみ。HANDOFF は「Handoff Prepared」→ 利用者が送信したら「User Marked Submitted」。

詳細は `docs/PLAN.md` から。
