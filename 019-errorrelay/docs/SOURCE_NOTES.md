# SOURCE_NOTES — 公式報告経路の確認記録

確認日: **2026-09-30**（開発環境: Claude Code cloud container, 日本時間 JST 基準で記録）

## 0. 重要な注記（必ず読む）

この開発環境の egress proxy では **help.openai.com / developers.openai.com / status.openai.com への直接アクセスがブロック** されていました
（`EGRESS_BLOCKED` エラー）。そのため以下の情報は

- **A. 一次資料を直接取得できたもの**（github.com / raw.githubusercontent.com）
- **B. 検索エンジンの結果スニペット経由で確認したもの**（公式ページの本文を検索結果で確認。URL は公式ドメイン）

に区別して記録しています。**B に分類したものは release 前に人間が公式ページを直接開いて再確認すること**（RELEASE_CHECKLIST.md にも記載）。
仕様は変わり得るため、送信経路は `config/channels.json` で更新可能な設計とし、app 本体へ固定しません。

## 1. OpenAI Support（ChatGPT / アカウント / 一般）

| 項目 | 内容 | 分類 |
|---|---|---|
| 公式窓口 | https://help.openai.com/en/articles/6614161-how-can-i-contact-support | B |
| 連絡方法 | help.openai.com 右下のチャットバブル（まず virtual assistant、必要時に human agent）。Help Center のフォームから written ticket。一般問い合わせは support@openai.com。電話サポートは無し。 | B |
| 公開 write API | **見つからず**。サポートチケットを作成する公開 API / SDK は公式資料に記載なし。 | B |
| 結論 | `OpenAISupportAdapter` の capability は **INTERACTIVE_HANDOFF**（報告文を準備し、公式窓口を開く／コピー）。DIRECT は不可。 | — |

## 2. ChatGPT Error Troubleshooting

| 項目 | 内容 | 分類 |
|---|---|---|
| 公式記事 | https://help.openai.com/en/articles/7996703-troubleshooting-chatgpt-error-messages （ja-jp 版: https://help.openai.com/ja-jp/articles/7996703） | B |
| 推奨手順 | ページ更新／新規チャット、status.openai.com の確認、cache/cookie 削除、シークレットウィンドウ、拡張機能無効化、VPN/secure DNS 無効化 | B |
| Support へ渡す情報 | **HAR file、browser console errors（timestamp 付き）、使用 model、conversation URL/ID**。複数 browser/device/network で再現し、status に incident が無い場合に Support へ。 | B |
| HAR ガイド | Developer Tools → Network → Preserve log → 再現 → download。HAR は headers/token を含み得る。 | B |
| ErrorRelay 反映 | Troubleshooting "Tried" チェックリストは上記手順に対応。HAR は取得ガイドのみ表示し、自動取得しない。iOS/Android native app では browser HAR 手順が使えないと明示。 | — |

## 3. OpenAI API エラー

| 項目 | 内容 | 分類 |
|---|---|---|
| Request ID | response header `x-request-id`。Support 連絡時に request ID を含める事が推奨。 | B（https://developers.openai.com/api/reference/overview） |
| 連絡先 | help.openai.com（同上 Support 窓口） | B |
| 結論 | Developer Issue 形式で request ID / endpoint / status / error type / SDK version / minimal repro を収集し、HANDOFF。 | — |

## 4. Codex（CLI / Desktop App / IDE extension）

| 項目 | 内容 | 分類 |
|---|---|---|
| `/feedback` | Codex CLI slash command。"opens the feedback dialog to submit feedback and optionally include logs"。 | B（https://developers.openai.com/codex/cli/slash-commands 等） |
| `codex doctor` | 「local diagnostic report を生成。`--json` で redacted machine-readable support report」。options: `--all --ascii --json --no-color`。 | B（developers.openai.com/codex/cli/reference） |
| 既知バグ | #44847 (2026-09-11, v0.154.0, Windows): `/feedback` でログ無しを選ぶと本文が通常チャットとして送られ、成功確認が出ない。#45512: Desktop(ChatGPT app bundled codex) で `/feedback` が発見できない。 | A（github.com/openai/codex/issues） |
| GitHub Issues | 公開。Issue templates: `1-codex-app.yml`, `2-extension.yml`, `3-cli.yml`, `4-bug-report.yml`, `5-feature-request.yml`, `6-docs-issue.yml`。 | A（raw.githubusercontent.com） |
| CLI template 項目 | version(必須, `codex --version`), plan(必須), model, platform(`uname -mprs`), terminal, doctor(`codex doctor --json`, JSON), actual(必須, PII redacted), steps(必須), expected, notes | A |
| App template 項目 | version(必須, About Codex), plan(必須), platform, actual(必須), steps(必須), expected, notes | A |
| contributing.md | 「Clear, detailed steps to reproduce / Expected and actual behavior / Codex version, OS / Logs with sensitive information removed / 先に既存 issue を検索」。security は SECURITY.md へ、public issue にしない。 | A |
| 結論 | `CodexFeedbackAdapter` = **INTERACTIVE_HANDOFF**（`/feedback` を案内、壊れている場合は GitHub Issue/Support へ）。`GitHubIssueAdapter` = 既定 **INTERACTIVE_HANDOFF**（template 付き new-issue URL を生成）。DIRECT は GitHub token を利用者が設定し、明示承認した場合のみ（既定 OFF）。 | — |

## 5. ChatGPT / Codex Plugins（MCP）

| 項目 | 内容 | 分類 |
|---|---|---|
| Quickstart | https://developers.openai.com/plugins/quickstart | B |
| MCP server | https://developers.openai.com/plugins/build/mcp-server — 各 tool に `title, description, inputSchema, outputSchema, annotations`。`readOnlyHint / destructiveHint / openWorldHint` を実挙動に合わせて **明示的 boolean** で設定。 | B |
| Submission | https://developers.openai.com/plugins/deploy/submission — 必要: plugin name, short/long description, logo, category, website URL, support URL, privacy policy URL, terms URL（HTTPS, ≤1024文字）、verified individual/business identity、Apps Management write access。production MCP server の tool scan 成功、`/.well-known/openai-apps-challenge` に verification token 設置。承認後に developer が publish、ChatGPT と Codex 共通の Plugins Directory に掲載。 | B |
| App review | https://developers.openai.com/plugins/deploy/app-review — public domain hosting（local/test endpoint 不可）、OAuth は CIMD / DCR / predefined client / PKCE。tool response に不要な personal data / auth secret / debug payload / internal identifier を含めない。 | B |
| Guidelines | https://developers.openai.com/plugins/plugin-guidelines | B（未読・release 前に要確認） |
| 結論 | `@errorrelay/mcp` は streamable HTTP + stdio。全 tool に annotations 明示。`submit_report` は `readOnlyHint:false, destructiveHint:false, openWorldHint:true`。description で「DIRECT 以外は送信しない」を明記。 | — |

## 6. OpenAI Status

| 項目 | 内容 | 分類 |
|---|---|---|
| ページ | https://status.openai.com （incident.io 基盤の模様。incident 個別ページ例: status.openai.com/incidents/01JMYB63BJ47J3SXV6KSCT4D2A） | B |
| JSON API | 公式に文書化された public JSON feed を **確認できず**。incident.io には Widget API があるが OpenAI がそれを公開しているか未確認。 | B/未確認 |
| 結論 | `OpenAIStatusAdapter` は status ページ URL の提示＋「取得できれば」config 指定の JSON URL を読む設計。取得不能時は `unknown` を返し「statusにない＝障害ではない」と表示。 | — |

## 7. 未確認・release 前に人間が確認する項目

1. help.openai.com 6614161 / 7996703 の本文（上記 B 項目）。
2. developers.openai.com plugins quickstart / mcp-server / submission / app-review / plugin-guidelines の最新本文。
3. Codex 最新版での `/feedback` の挙動（ログ無し送信バグ #44847 が修正済みか）と `codex doctor --json` の出力形式。
4. status.openai.com の JSON feed の有無。
5. OpenAI Support の推奨報告項目（4章の最低項目に追加があるか）。
