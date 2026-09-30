# REPORT_SCHEMA (schemaVersion 1.0.0)

定義: `packages/core/src/schema/report.ts`（zod）。`validateReport()` で検証。`generateJson()` は tenantId / storageRef を除いた export 用。

## Report
| フィールド | 型 | 説明 |
|---|---|---|
| id | `rep_<uuid>` | |
| schemaVersion | string | major が一致しないと validation error |
| tenantId | string | サーバー内部。export では除去 |
| status | draft / ready / handoff_prepared / submitted / user_marked_submitted / submission_failed / submission_unknown / closed / cancelled | `submitted` は DIRECT + receipt 必須 |
| language | ja / en | |
| createdAt / updatedAt / reportedAt | ISO UTC | reportedAt は ready 到達または送信時 |
| capturedAt | Timestamp \| null | 証拠が撮られた時刻（EXIF 等）。occurredAt と別 |
| occurredAt | Timestamp \| null | 発生時刻。null=不明（捏造しない） |
| summary, description | string | |
| product | ProductId | chatgpt_web/ios/android/desktop, codex_cli/desktop/ide, openai_api, other, unknown |
| productOther | string \| null | |
| steps | string[] | |
| expected, actual, errorText | string | |
| errorCode, requestId, conversationId, endpoint | string \| null | |
| httpStatus | int \| null | |
| frequency | first_time / sometimes / always / unknown | |
| retried | bool \| null | |
| troubleshootingTried | string[] | 利用者が実際に行ったものだけ |
| additionalNotes | string | |
| rootCause | { level: confirmed/likely/possible/unknown, note } | 既定 unknown（症状の報告に集中） |
| environment | Environment | 各 field `{ value, source: auto/manual/inferred/unknown }` |
| attachments | Attachment[] | |
| analysis | Analysis \| null | observed / inferred / visibleText / provider / analyzedAt |
| redaction | RedactionSummary \| null | counts（カテゴリ→件数）, keptCategories。元文字列は含まない |
| submissions | Submission[] | adapterId, capability, status(prepared/sent/failed/unknown/user_marked_submitted), idempotencyKey, receipt, ticketId |
| followups | Followup[] | question, reply, additions, ticketId |
| revisions | Revision[] | 内容 field の snapshot |
| targetChannel | string \| null | |
| localOnly | bool | PWA オフライン下書き |
| deletedAt | ISO \| null | |

## Timestamp
`{ iso (UTC), timezone (IANA), display ("2026-09-30 13:44 GMT+9 / Asia/Tokyo"), source (user_now/user_manual/screenshot_metadata/screenshot_visible/log/system/unknown), confidence (high/medium/low) }`

## Attachment
`{ id, kind (screenshot/image/log/har/doctor/text/other), fileName, mimeType, sizeBytes, sha256, redacted, redactedFrom, exifStripped, included, storageRef (export 時 null), createdAt }`

## Package layout
```
report.json  report_ja.txt  report_en.txt  environment.json  manifest.json
attachments/  (originals: 既定で含めない)
redacted/     (マスク済み)
```
manifest: schemaVersion, packageSchemaVersion, reportId, createdAt, product, files[{path,sha256,bytes}], attachments[{id,path,sha256,redacted}]。秘密情報は入らない（builder が guardFindings で検査し、残っていれば SecretLeakError）。
