export type Lang = "ja" | "en";
const S = {
  ja: {
    settings: "設定", homeHistory: "過去の報告", tagline: "エラー画面を渡すだけ。開発元に伝わるバグ報告をAIがまとめます。",
    fromScreenshot: "スクショから報告を作る", fromText: "エラー文から報告を作る", fromCodex: "Codex診断から作る", history: "過去の報告",
    step1: "1. 証拠を追加", step2: "2. AIが整理", step3: "3. 確認して報告",
    noGuarantee: "報告が必ず修正・閲覧される、またはAIの改善に使われることは保証されません。",
    drop: "ここにスクショをドロップ、貼り付け（Ctrl/⌘+V）、または選択", choose: "画像を選ぶ", errorText: "エラー文（そのまま貼り付け）", occurred: "発生日時", now: "今起きた", manualTime: "日時を入力（例: 2026-09-30 13:44）", timezone: "タイムゾーン",
    product: "対象製品", next: "次へ", back: "戻る", save: "保存", description: "何をしていましたか？（自然な文章でOK）", proposeSteps: "再現手順を提案", apply: "この内容を使う", steps: "再現手順（1行1手順）", expected: "本来どうなるはず？（Expected）", actual: "実際にはどうなった？（Actual）",
    frequency: "再現頻度", first_time: "初めて", sometimes: "時々", always: "毎回", unknown: "不明", retried: "再試行した？", yes: "はい", no: "いいえ",
    env: "環境", envAuto: "ブラウザから自動取得", envHint: "分からない項目は空欄のままで構いません（「不明」として扱います）。", device: "端末（例: iPhone 15）", os: "OS", osVersion: "OSバージョン", appVersion: "アプリ/CLIバージョン", model: "モデル（分かれば）", browser: "ブラウザ",
    tried: "試したこと（実際に自分で行ったものだけ）", scan: "秘密情報をスキャン", scanDisclaimer: "自動検出は完全ではありません。送信前に必ず目視で確認してください。", redactAll: "検出した項目を全てマスク", keep: "そのまま残す", found: "検出", none: "検出なし",
    imageRedact: "画像のマスク", imageRedactHelp: "ドラッグで黒塗り範囲を作成。キーボード: Enter で枠追加、矢印で移動、Ctrl+矢印でサイズ変更、Delete で削除。", addBox: "枠を追加", saveRedacted: "マスク済みコピーを保存", cropSave: "選択枠で切り抜いて保存", exclude: "この画像を除外", imageChecklist: "画像の目視チェック",
    quality: "送信前チェック", preview: "プレビュー", format: "形式", lang: "言語", markReady: "内容を確認した（送信準備完了）", channels: "報告先", capability: "送信方法", prepare: "この報告先で準備", confirmTitle: "送信内容の最終確認", destination: "送信先", body: "本文", attachments: "添付", pii: "マスク済みの個人情報", identity: "相手に見える身元", confirmSend: "送信する", confirmHandoff: "準備完了にする", cancel: "キャンセル",
    handoffDone: "報告文を準備しました。公式窓口で内容を確認して、ご自身で送信してください。", openChannel: "公式窓口を開く", copyBody: "本文をコピー", copied: "コピーしました", markSent: "自分で送信した", ticketId: "チケット/Issue番号（任意）", export: "書き出し",
    status: "状態", delete: "削除", deleteConfirm: "この報告と添付をすべて削除します。よろしいですか？", followup: "サポートからの追加質問に返信", question: "質問文を貼り付け", additions: "追加情報（項目: 値、1行ずつ）", makeReply: "返信文を作る",
    localOnly: "この端末のみ（オフライン下書き）", serverSaved: "サーバー保存", mode: "保存先", modeLocal: "この端末だけ（サーバー不要・AI分析なし）", modeServer: "ErrorRelay サーバー（AI分析・共有履歴）", serverUrl: "サーバーURL", token: "アクセストークン", wipe: "この端末のデータをすべて消去", wiped: "消去しました",
    knownIssues: "既知の問題を確認", statusPage: "OpenAI ステータスページ", aiConsent: "画像を AI に送って解析する（AI 提供元へ画像が送信されます）", analyze: "AI で解析", manualFallback: "AI 解析は使えません。エラー文を手入力してください。", observed: "画像から読み取れた情報", inferred: "推測（要確認）", confirm: "確認済みにする",
    unresolved: "未処理の検出項目があります。戻ってマスクするか、「そのまま残す」を選んでください。", missing: "不足", ok: "OK", warn: "任意",
    capturedHint: "画像に記録された日時候補", useAsOccurred: "発生日時として使う", importPkg: "パッケージ(ZIP)を読み込む", codexPaste: "codex doctor --json の出力を貼り付け（マスクしてから添付）", apiPaste: "OpenAI API エラー（JSON/ログ）を貼り付け", parse: "解析", harGuide: "HARファイルの取り方",
  },
  en: {
    settings: "Settings", homeHistory: "Past reports", tagline: "Hand over the error screen. AI writes a bug report developers can act on.",
    fromScreenshot: "Report from a screenshot", fromText: "Report from error text", fromCodex: "Report from Codex diagnostics", history: "Past reports",
    step1: "1. Add evidence", step2: "2. AI organizes", step3: "3. Review and report",
    noGuarantee: "There is no guarantee the report will be fixed, read, or used to improve AI.",
    drop: "Drop a screenshot here, paste (Ctrl/⌘+V), or choose a file", choose: "Choose image", errorText: "Error text (paste as-is)", occurred: "When did it happen?", now: "It just happened", manualTime: "Enter time (e.g. 2026-09-30 13:44)", timezone: "Timezone",
    product: "Product", next: "Next", back: "Back", save: "Save", description: "What were you doing? (plain language is fine)", proposeSteps: "Propose steps", apply: "Use this", steps: "Steps to reproduce (one per line)", expected: "What should have happened? (Expected)", actual: "What actually happened? (Actual)",
    frequency: "Frequency", first_time: "First time", sometimes: "Sometimes", always: "Every time", unknown: "Unknown", retried: "Did you retry?", yes: "Yes", no: "No",
    env: "Environment", envAuto: "Auto-capture from browser", envHint: "Leave unknown fields empty (they are reported as unknown).", device: "Device (e.g. iPhone 15)", os: "OS", osVersion: "OS version", appVersion: "App/CLI version", model: "Model (if known)", browser: "Browser",
    tried: "Troubleshooting you actually tried", scan: "Scan for secrets", scanDisclaimer: "Automatic detection is not exhaustive. Always review manually before sending.", redactAll: "Redact all findings", keep: "Keep as-is", found: "found", none: "none found",
    imageRedact: "Image redaction", imageRedactHelp: "Drag to draw a solid box. Keyboard: Enter adds a box, arrows move, Ctrl+arrows resize, Delete removes.", addBox: "Add box", saveRedacted: "Save redacted copy", cropSave: "Crop to selected box and save", exclude: "Exclude this image", imageChecklist: "Manual image checklist",
    quality: "Pre-send checklist", preview: "Preview", format: "Format", lang: "Language", markReady: "I reviewed it (ready to send)", channels: "Where to report", capability: "How it is sent", prepare: "Prepare for this channel", confirmTitle: "Final confirmation", destination: "Destination", body: "Body", attachments: "Attachments", pii: "Redacted personal data", identity: "Identity visible to recipient", confirmSend: "Send", confirmHandoff: "Mark prepared", cancel: "Cancel",
    handoffDone: "The report is prepared. Review and send it yourself at the official channel.", openChannel: "Open official channel", copyBody: "Copy body", copied: "Copied", markSent: "I sent it myself", ticketId: "Ticket / issue number (optional)", export: "Export",
    status: "Status", delete: "Delete", deleteConfirm: "Delete this report and all attachments?", followup: "Reply to a follow-up question from support", question: "Paste the question", additions: "Additional info (key: value, one per line)", makeReply: "Draft reply",
    localOnly: "This device only (offline draft)", serverSaved: "Saved on server", mode: "Storage", modeLocal: "This device only (no server, no AI analysis)", modeServer: "ErrorRelay server (AI analysis, shared history)", serverUrl: "Server URL", token: "Access token", wipe: "Wipe all data on this device", wiped: "Wiped",
    knownIssues: "Check known issues", statusPage: "OpenAI status page", aiConsent: "Send the image to AI for analysis (the image is transmitted to the AI provider)", analyze: "Analyze with AI", manualFallback: "AI analysis is unavailable. Type the error text manually.", observed: "Read from the image", inferred: "Inferred (confirm)", confirm: "Mark confirmed",
    unresolved: "There are unresolved findings. Go back and redact them, or choose 'Keep as-is'.", missing: "Missing", ok: "OK", warn: "Optional",
    capturedHint: "Timestamp recorded in the image", useAsOccurred: "Use as occurred time", importPkg: "Import package (ZIP)", codexPaste: "Paste `codex doctor --json` output (redact before attaching)", apiPaste: "Paste an OpenAI API error (JSON/log)", parse: "Parse", harGuide: "How to record a HAR file",
  },
} as const;
export type Key = keyof typeof S.ja;
export function t(lang: Lang, k: Key): string {
  return S[lang][k];
}
