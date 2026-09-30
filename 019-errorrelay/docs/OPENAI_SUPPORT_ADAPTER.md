# OPENAI_SUPPORT_ADAPTER

- capability: **INTERACTIVE_HANDOFF**（公開チケット API なし。SOURCE_NOTES §1）
- 窓口: https://help.openai.com/ 右下チャット（virtual assistant → human agent）、Help Center フォーム、support@openai.com（一般）
- 準備する項目（4 章）: Issue Summary, Product, Platform, Device, OS, App/CLI Version, Model, Occurred At, Timezone, Frequency, Description, Steps to Reproduce, Expected, Actual, Error Message, Conversation/Request ID, Attachments, Troubleshooting Already Tried, Additional Notes → `prepare()` の `formFields`
- account email は自動収集しない。password / OTP / API secret は要求しない（scanner が検出したら redaction 対象）。
- Web UI 問題では HAR を求められることがある → 取得ガイドのみ表示（`docs/buyer/ログを添付する前に.txt`）。iOS/Android ネイティブアプリでは HAR 手順が使えないと明記。
- release 前に OpenAI 公式の最新推奨項目を再確認し、`formFields` を更新する（RELEASE_CHECKLIST）。
- Support から追加質問 → follow-up 機能（元 report を上書きせず revision）。Ticket ID は利用者入力。
