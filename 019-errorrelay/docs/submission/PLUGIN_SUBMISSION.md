# Plugin submission materials（ChatGPT / Codex Plugins Directory）

要件は SOURCE_NOTES §5 参照（release 前に developers.openai.com で再確認）。

## Listing
- Plugin name: ErrorRelay
- Short description (EN): Turn an error screenshot or message into a clear, privacy-safe bug report and hand it to the official support channel.
- Short description (JA): エラー画面を渡すだけ。開発元に伝わるバグ報告を AI がまとめます。
- Long description: see `LISTING_LONG.md`
- Category: Developer tools / Productivity
- Logo: `apps/pwa/public/icon-512.png`（要ブランド差し替え）
- Website URL: https://<your-domain>/
- Support URL: https://<your-domain>/support
- Privacy policy URL: https://<your-domain>/privacy （`docs/buyer/PRIVACY.md` を公開）
- Terms URL: https://<your-domain>/terms （`TERMS_DRAFT.md`）

## MCP server
- URL: https://<your-domain>/mcp（public HTTPS、universal endpoint）
- Auth: 現状 bearer token。Directory 公開には OAuth（CIMD / DCR / PKCE）が求められる可能性 → app-review ページで確認し、必要なら OAuth 層を追加（NEXT_STEPS）。
- Verification: `/.well-known/openai-apps-challenge` に発行された token をホスト（server の static / reverse proxy で配置）。
- Tool annotations: 全 12 tool に readOnlyHint / destructiveHint / openWorldHint を明示（MCP_PLUGIN.md）。
- Tool responses: compact() で必要最小限。secret / internal id / debug payload を含まない。

## Review 時に問われそうな点と回答
- 「submit_report は何を送るのか」→ DIRECT capability の channel だけ。既定構成では DIRECT channel は存在せず、常に handoff。
- 「画像はどこへ送られるか」→ 利用者同意時のみ、設定された AI provider へ 1 枚。
- 「個人データの保持」→ 既定 30 日、利用者削除可、テナント分離、暗号化。
- 「OpenAI の内部 API を使うか」→ 使わない。

## 提出状態
**未提出**。デプロイ・identity 検証・URL 公開後に人間が提出する。
