# PRIVACY_REDACTION

## 検出（`privacy/scanner.ts`, SCANNER_VERSION 1.0.0）
email, phone（10–15 桁）, api_key（sk-, sk-proj-, sk-svcacct-, ghp_/gho_/…, github_pat_, AKIA, xox*, AIza, sk-ant-, key=value 形式）, access_token（Bearer, token=）, jwt, session_token, password, otp, credit_card（Luhn）, account_id（user-/org-/…）, file_path_username（/Users/x, /home/x, C:\Users\x）, ip_address, postal_address（〒, street）, url_with_token, person_name（Name: 形式）。
重なりは severity → 長さで 1 件に統合。

画像内の顔・QR・私的会話・顧客データ・氏名は自動検出しない → `IMAGE_MANUAL_CHECKLIST` を UI に表示し、利用者が確認。

## 免責
「自動検出は完全ではありません。送信前に必ず目視で確認してください。」を scan 結果・redact tool・preview に表示。

## Redaction
- テキスト: `[REDACTED_<CATEGORY>_<n>]` の solid placeholder。部分マスク（`sk-…abcd`）は使わない。placeholder → 原文の Map はメモリのみ。
- カテゴリごとに「そのまま残す」を選択可能（keptCategories として記録、preview に表示）。
- 画像: canvas で黒塗り（blur ではなく solid）、crop、除外。出力は再エンコード PNG（EXIF 無し）。元画像は上書きせず別 attachment（included=false）。
- EXIF/metadata: JPEG APP1〜APP15（APP0/APP14 以外）と COM、PNG tEXt/iTXt/zTXt/eXIf/tIME を byte レベルで除去。WebP/GIF は unsupported として明示（再エンコードで対応）。
- Package: builder が `guardFindings` に含まれる原文が出力に残っていないか検査し、残っていれば `SecretLeakError` で export 拒否。manifest に秘密情報を入れない。
- Codex doctor: identity/path key（home, cwd, workspace, user, email, auth, token, session, thread_id …）を `[REMOVED]`、全 string をスキャン、最終テキストにもう一度スキャン。
- API request/response: body 全体を勝手に添付しない。`redactApiBody()` で redaction 後、利用者選択で添付。minimal repro は `$OPENAI_API_KEY` placeholder。

## テスト
core/test/privacy.test.ts（4, 5, 6, 24, 25, 30 等）、E2E-4（Playwright: ZIP 内に元 secret が無いこと）。
