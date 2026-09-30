# TEST_REPORT（2026-09-30）

## 自動テスト
```
npm test        → 8 files, 62 tests passed（vitest 3.2）
npm run test:e2e → 15 passed（Playwright 1.56, Chromium: desktop 1280x800 / iPhone 14 / Pixel 7）
                  + screenshots.spec（3 passed, docs/screenshots/）
```

## 必須テスト（34 章）対応表
| # | 内容 | テスト | 結果 |
|---|---|---|---|
| 1 | Screenshot なしで text report | core report.test「creates a text-only report」 | ✅ |
| 2 | Screenshot から visible error 抽出 | core adapters.test「extracts visible error text」(MockProvider) | ✅（実モデルは未検証） |
| 3 | 見えない device model を断定しない | 同上（device → inferred/low/unconfirmed）+ env capture | ✅ |
| 4 | Screenshot secret 候補を警告 | privacy.test「detects the major categories」+ PWA scan | ✅ |
| 5 | Redacted export に元 secret なし | privacy.test package + E2E-4 (ZIP 検査) | ✅ |
| 6 | EXIF 除去 | privacy.test（JPEG APP1 / PNG tEXt）+ server upload test | ✅ |
| 7 | Occurred/Reported 分離 | report.test | ✅ |
| 8 | timezone 正確性 | timestamp.test（JST, DST, invalid） | ✅ |
| 9 | Unknown を捏造しない | report.test「does not fabricate」 | ✅ |
| 10 | 自然文→repro steps | report.test（ja/en）+ E2E-1 | ✅ |
| 11 | Expected/Actual 生成 | report.test | ✅ |
| 12 | adapter capability | adapters.test | ✅ |
| 13 | HANDOFF を Submitted 扱いしない | adapters.test, mcp.test, E2E-1 | ✅ |
| 14 | DIRECT なし時に endpoint を呼ばない | adapters.test（fetch 監視） | ✅ |
| 15 | send 前 confirmation | adapters.test（ConfirmationRequiredError）+ server 400 | ✅ |
| 16 | retry で二重送信しない | adapters.test（DIRECT test double, unknown→retry→sent→no-op） | ✅ |
| 17 | report JSON schema validation | report.test + server PATCH 400 | ✅ |
| 18 | ZIP path traversal | privacy.test「rejects zip slip」 | ✅ |
| 19 | tenant A→B 拒否 | server.test | ✅ |
| 20 | signed URL 期限 | server.test | ✅ |
| 21 | deleted report の attachment 拒否 | server.test | ✅ |
| 22 | AI OFF 時に provider request なし | adapters.test（fetchImpl 監視） | ✅ |
| 23 | provider failure でも manual 作成 | adapters.test | ✅ |
| 24 | Codex log redaction | privacy.test + e2e_flows (E2E-2) | ✅ |
| 25 | API key pattern redaction | privacy.test + E2E-3 | ✅ |
| 26 | follow-up が元 report を破壊しない | report.test | ✅ |
| 27 | iPhone narrow viewport | Playwright iphone project（overflow なし、44px tap target） | ✅（エミュレーション） |
| 28 | Android/desktop | Playwright android/desktop project | ✅（エミュレーション） |
| 29 | PWA offline draft と server saved の区別 | Playwright server mode test | ✅ |
| 30 | export 再 import で内容一致 | privacy.test + E2E-4 | ✅ |

## E2E（35 章）
| ID | 内容 | 実施 |
|---|---|---|
| E2E-1 | ChatGPT iOS: screenshot → 時刻 → 分析(manual fallback) → repro → redact → Support report → HANDOFF | Playwright 3 端末 ✅ |
| E2E-2 | Codex: error text → version → doctor redaction → capability → handoff/export | server e2e_flows ✅ |
| E2E-3 | OpenAI API: error JSON → request ID → SDK → secret redaction → Developer report | server e2e_flows ✅ |
| E2E-4 | secret 入り → scanner → solid redaction → package に secret なし | Playwright ✅ |
| E2E-5 | route 変更を config で反映、schema 不変 | core adapters.test ✅ |
| E2E-6 | DIRECT test double: send→receipt→Submitted、timeout→Unknown→再送 idempotency | core adapters.test ✅ |

## Load / error
200 並列 POST（rate limit 150/分）: 150 × 201, 50 × 429, < 10 秒。provider 500 / timeout → manual fallback。

## 未実施（人間による確認が必要）
- 実機: iPhone Safari（PWA インストール、Photos 選択、貼り付け）、Android Chrome、Windows/macOS のクリップボード連携（Companion の pngpaste/osascript/PowerShell/wl-paste/xclip 経路）。
- 実 AI provider での vision 精度。
- ChatGPT / Codex への MCP 接続と会話例の再現。
- `codex doctor --json` の実出力形式（Codex 未インストール環境のため、unavailable 経路のみテスト済み）。
