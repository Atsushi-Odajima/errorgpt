# PLAN — ErrorRelay 実装計画

## 目的
AI 製品・開発ツール（まず OpenAI: ChatGPT Web/iOS/Android/Desktop、Codex CLI/Desktop/IDE、OpenAI API）で発生したエラーを、利用者が簡単・安全に開発元へ報告できるようにする。

## 中心フロー
エラー発生 → 証拠（スクショ/画像/ログ/エラー文）→ 発生日時+timezone → 製品選択/推定 → エラー文抽出 → 直前操作の整理 → 環境情報（取得可能な範囲）→ 個人情報/secret 検出 → redaction → 再現手順/Expected/Actual 構造化 → preview → 公式報告経路の capability 確認 → DIRECT なら明示承認後送信 / それ以外は Interactive Handoff → 履歴保存。

## Phase と状態（2026-09-30）

| Phase | 内容 | 状態 |
|---|---|---|
| 0 | 公式経路調査、Plugin/MCP 仕様、report schema | 完了（一部は検索スニペット経由の確認。SOURCE_NOTES 参照） |
| 1 | PWA、Report CRUD、Screenshot/Text 入力、timestamp/environment | 完了 |
| 2 | Vision/error 抽出、Reproduction Builder、Expected/Actual | 完了（Vision は provider 抽象。実 API での検証は未実施＝環境に API key 無し） |
| 3 | Privacy scanner、redaction（text/image/EXIF）、export package | 完了 |
| 4 | OpenAI Support / Codex / GitHub / Generic adapters、capability model | 完了 |
| 5 | MCP Plugin tools、ChatGPT/Codex integration | 実装完了。ChatGPT/Codex 実機接続は未検証（Plugin 提出前に要確認） |
| 6 | Desktop Companion、Codex diagnostics helper | 基本機能完了（Node CLI + localhost）。Electron 等の GUI 化は未実施 |
| 7 | Known Issue/Status 検索、follow-up | 完了（status JSON feed は未確認のため URL 提示＋config で有効化） |
| 8 | Security、retention、backup/export、accessibility | 完了（基本） |
| 9 | PC/iPhone/Android/Codex E2E、load/error tests | Playwright（Chromium 端末エミュレーション）で完了。実機は未検証 |
| 10 | Plugin submission 資料、docs、deploy、販売前 check | 資料完了。デプロイ/提出は人間の判断待ち |

## 技術スタック
- Node.js 22 / TypeScript 5.9 / npm workspaces
- core: zod 3, fflate
- server: Hono 4 + @hono/node-server, @modelcontextprotocol/sdk 1.31
- PWA: Vite 6, vanilla TS（フレームワーク非依存、174 KB JS）
- テスト: vitest 3, @playwright/test 1.56（Chromium）

## 非スコープ（36章）
非公開 OpenAI endpoint、アプリ内部への hook、background capture、keylogger、会話全取得、password/OTP 収集、support impersonation、CAPTCHA bypass、大量送信、確認なし送信、原因断定、偽 request ID。
