# CODEX_ADAPTER

## 公式 feedback mechanism（2026-09-30 時点）
- `/feedback`（Codex CLI / Desktop）: フィードバックダイアログを開き、任意でログを含める。
- `codex doctor --json`: redacted machine-readable support report。
- GitHub Issues（openai/codex）: 公開。テンプレート 1-codex-app / 2-extension / 3-cli / 4-bug-report。
- 既知バグ: #44847（ログ無し /feedback が通常チャットとして送られる）、#45512（Desktop で /feedback が見つからない）。

## ErrorRelay の挙動
1. `codex --version` の取得（Companion のボタン操作、または利用者入力）。
2. 必要なら `codex doctor --json` を提案 → Companion が実行 → `redactDoctorOutput()`（identity/path key 除去 + 全 string スキャン + 最終テキストパス）→ preview → 承認後のみ添付。生 JSON は PWA に返さない。
3. report 生成（developer 形式）。
4. capability: `codex_feedback` = INTERACTIVE_HANDOFF。caveats に既知バグと fallback を表示。
5. feedback flow が壊れている場合: 利用者が additionalNotes に記録 → `github_issue_codex`（テンプレート付き URL）または `openai_support` / export へ。
6. GitHub Issue の DIRECT 投稿は既定 OFF。有効化には token を server に設定し（client には渡さない）、config で `capability: DIRECT`、かつ preview 後の明示承認が必要。Issue は公開されるため secret / PII の未処理があれば preview で送信ボタンを無効化。

## MCP (stdio) の登録例（Codex CLI）
`~/.codex/config.toml`
```toml
[mcp_servers.errorrelay]
command = "node"
args = ["/path/to/019-errorrelay/packages/mcp/dist/bin.js"]
env = { ERRORRELAY_DATA_DIR = "/path/to/data", ERRORRELAY_TENANT = "local" }
```
（設定キー名は Codex の現行 docs で要確認。）
