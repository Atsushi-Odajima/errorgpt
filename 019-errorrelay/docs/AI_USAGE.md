# AI_USAGE

## 原則
- AI は **既定 OFF**（`NullProvider`）。OFF のとき provider へのリクエストは一切発生しない（テスト 22）。
- provider / model は設定可能（`ERRORRELAY_AI_ENABLED`, `ERRORRELAY_AI_BASE_URL`, `ERRORRELAY_AI_MODEL`, `ERRORRELAY_AI_API_KEY`）。OpenAI-compatible な chat/completions（vision 対応）であれば利用可。
- 画像/ログを AI へ送る前に明示同意（PWA のチェックボックス、MCP の `user_consented_to_ai: true`、API の `consent: true`）。
- 送る画像は **redaction 前の原画像**（利用者がその attachment を選んだ場合）。理由: 可視テキストを抽出するため。範囲: その 1 枚の画像と言語ヒントのみ。会話全文・他の attachment は送らない。可能なら先にマスク済みコピーを作り、そちらを解析対象に選ぶことを UI で案内。
- provider 障害時も manual で report 作成可能（テスト 23）。

## 出力の扱い
- Vision の結果は `observed`（画像に文字通り見える）と `inferred`（推測）に分離。device/osVersion/appVersion/model/account/email は可視証拠が無ければ observed から inferred に降格（`sanitizeVision`）。
- inferred は利用者が confirm するまで report の environment に入らない。
- 再現手順の AI 提案は `needsConfirmation: true`、不明な step は question として返す（捏造しない）。
- Root cause は confirmed / likely / possible / unknown。既定 unknown。AI に原因を断定させない（prompt でも禁止）。

## コスト
OPERATING_COSTS.md 参照。画像 1 枚 + JSON 出力で概ね数千 token。

## 未検証
実 API key が無いため、実 vision モデルでの精度は未検証。release 前に実画像で確認し、TEST_REPORT に追記する。
