# DECISIONS — 設計判断の記録

| # | 判断 | 理由 |
|---|---|---|
| D1 | OpenAI Support / Codex feedback は **INTERACTIVE_HANDOFF** 固定、DIRECT にしない | 公開 write API が無い。非公開 endpoint の推測・reverse engineering は禁止要件 |
| D2 | `submitted` 状態は DIRECT の receipt がある場合のみ。schema validation でも強制 | 「送信済み」の誤表示防止（完成条件 9, テスト 13） |
| D3 | 送信経路は `channels.json`（config）で更新。adapter kind は文字列で解決し未知 kind は Web フォーム handoff として扱う | 公式経路の変更に app 本体を変えず追従（E2E-5） |
| D4 | GitHub Issue の DIRECT は「token 注入＋config で DIRECT 指定」の両方が必要。既定は HANDOFF | 実 Issue 作成を勝手に行わない要件。明示承認は preview → confirmation token で担保 |
| D5 | redaction は partial mask ではなく **solid placeholder**（`[REDACTED_API_KEY_1]`）。placeholder→原文の map はメモリのみで serialize しない | export に元文字列が残らない（テスト 5） |
| D6 | 画像 redaction は canvas で黒塗り + 再エンコード。元画像は上書きせず別 attachment。EXIF は byte レベルで除去 | 要件 9。元画像は既定で package に含めない |
| D7 | 推測値（Vision の inferred）は environment に書き込まず `analysis.inferred` に保持し、利用者が confirm したときだけ manual として反映 | 見えない端末 model を断定しない（テスト 3） |
| D8 | 再現手順はルールベースを既定、AI は enabled の場合のみ。AI 結果も needsConfirmation | AI OFF でも動く。捏造防止は「不明は question として返す」 |
| D9 | timestamp は UTC ISO + IANA tz + display を保持。capturedAt / occurredAt / reportedAt を分離 | 要件 10 |
| D10 | PWA は **ローカルモード**（IndexedDB, サーバー不要）と **サーバーモード** の二層。ローカルは AI なし | 「保存しないモード」/オフライン下書きと server saved の区別（テスト 29） |
| D11 | Desktop Companion は Electron ではなく Node CLI + localhost HTTP（token + origin 制限） | 依存最小、read-only。GUI 化は別 Phase |
| D12 | storage は File ベース + AES-256-GCM（key 設定時）。Storage interface で S3/Postgres へ差し替え可能 | 単一ノードで十分。encryption at rest は基盤依存の要件に沿う |
| D13 | Quality check はスコアなしのチェックリスト | 要件 13「品質スコアで利用者を評価しない」 |
| D14 | Status JSON feed は既定 null。取得不能は `unknown` として「statusに無い＝障害でない」と言わない | 公式 feed の存在を確認できていない |
| D15 | Logger は全 string フィールドをスキャンして redact、body/screenshot キーは出力しない | 要件 21 |
| D16 | MCP tool の annotations を全て明示 boolean、`submit_report` の description に送信条件を明記 | OpenAI Plugins の要件（SOURCE_NOTES §5） |
| D17 | Codex adapter の caveats に既知バグ（#44847, #45512）を記載し、fallback（GitHub Issue / Support）を案内 | 要件 29 |
