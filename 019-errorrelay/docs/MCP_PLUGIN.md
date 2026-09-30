# MCP_PLUGIN

## Transport
- streamable HTTP: server の `/mcp`（bearer token → tenant）。stateless（sessionIdGenerator undefined）。
- stdio: `packages/mcp/dist/bin.js`（ローカル利用）。

## Tools（`packages/server/src/mcp.ts`）
| tool | readOnly | destructive | openWorld | 説明 |
|---|---|---|---|---|
| create_error_report | false | false | false | draft 作成。製品推定は low confidence なら unknown のまま |
| analyze_error_screenshot | false | false | true | AI vision。`user_consented_to_ai: true` 必須。observed/inferred 分離。AI OFF → manualFallback |
| add_reproduction_step | false | false | false | steps/expected/actual/frequency。description からの提案は needsConfirmation |
| add_environment_info | false | false | false | 利用者が述べた値のみ manual として保存 |
| redact_report | false | false | false | text redaction。免責文を返す |
| preview_report | true | false | false | 形式/言語でレンダリング + quality checklist |
| find_official_report_channel | true | false | true | capability 付き channel 一覧、既知障害（任意） |
| prepare_submission_package | false | false | false | ready 化 + preview（送信先/本文/添付/PII/identity）+ confirmation_token。送信しない |
| submit_report | false | false | true | DIRECT のみ実送信。HANDOFF/EXPORT は「準備しました」。idempotency_key で二重送信防止 |
| export_report | true | false | false | テキスト出力 |
| list_my_reports | true | false | false | 自 tenant のみ |
| get_report | true | false | false | |

## 会話例（28 章）
User: 「このエラー報告して」（画像添付）
1. PWA/Companion で upload 済みの attachment を `analyze_error_screenshot`（同意後）
2. 「ChatGPT iOS のファイル download error のようです」（inferred として提示）
3. 不足のみ質問: 発生日時 / timezone、app version
4. `preview_report` で本文提示
5. `redact_report` 結果（件数）提示
6. `find_official_report_channel` → openai_support: INTERACTIVE_HANDOFF
7. DIRECT なら「この内容で送信しますか？」→ `submit_report`
8. HANDOFF なら `prepare_submission_package` →「OpenAI Support 向けに準備しました。公式窓口を開きます / コピーします」

## 画像の受け渡し
MCP tool は画像バイナリを受け取らない（サイズ・secret 管理のため）。画像は PWA / Companion から server に upload し、attachment_id を tool に渡す。

## 提出要件（SOURCE_NOTES §5）
public HTTPS domain、tool annotations 明示、tool response に不要な PII / secret / internal id を含めない（compact() で最小化）、privacy/terms/support URL、`/.well-known/openai-apps-challenge`。
