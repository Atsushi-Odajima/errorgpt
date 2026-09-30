import type { ChannelsConfig } from "./types.js";

/**
 * Default official routes as verified on 2026-09-30 (see docs/SOURCE_NOTES.md).
 * Operators override this with config/channels.json; the schema of the report never depends on it.
 */
export const DEFAULT_CHANNELS: ChannelsConfig = {
  configVersion: "2026-09-30.1",
  updatedAt: "2026-09-30",
  channels: [
    {
      adapterId: "openai_support",
      enabled: true,
      capability: "INTERACTIVE_HANDOFF",
      officialUrl: "https://help.openai.com/",
      verifiedAt: "2026-09-30",
      sourceUrls: ["https://help.openai.com/en/articles/6614161-how-can-i-contact-support", "https://help.openai.com/en/articles/7996703-troubleshooting-chatgpt-error-messages"],
      name: { ja: "OpenAI サポート（公式ヘルプセンター）", en: "OpenAI Support (Help Center)" },
      instructions: {
        ja: ["help.openai.com を開き、右下のチャットアイコンから問い合わせを開始します。", "最初は自動応答です。人の担当者に繋がったら、準備した報告文を貼り付けます。", "スクリーンショットはマスク済みのものだけを添付してください。", "アカウントのメールアドレスは求められた場合に自分で入力します（ErrorRelay は収集しません）。"],
        en: ["Open help.openai.com and start a chat from the bubble at the bottom right.", "A virtual assistant answers first. When a human agent joins, paste the prepared report.", "Attach only redacted screenshots.", "Enter your account email yourself if asked (ErrorRelay never collects it)."],
      },
      caveats: {
        ja: ["OpenAI Support にチケットを作成する公開 API は存在しないため、自動送信はできません。", "Web UI の不具合では HAR ファイルを求められることがあります（「ログを添付する前に.txt」参照）。"],
        en: ["There is no public API for creating OpenAI Support tickets; automatic submission is not possible.", "For web UI issues Support may ask for a HAR file (see the HAR guide)."],
      },
      products: ["chatgpt_web", "chatgpt_ios", "chatgpt_android", "chatgpt_desktop", "openai_api", "codex_cli", "codex_desktop", "codex_ide", "other", "unknown"],
      options: { kind: "openai_support" },
    },
    {
      adapterId: "codex_feedback",
      enabled: true,
      capability: "INTERACTIVE_HANDOFF",
      officialUrl: "https://developers.openai.com/codex/cli/slash-commands",
      verifiedAt: "2026-09-30",
      sourceUrls: ["https://developers.openai.com/codex/cli/slash-commands", "https://github.com/openai/codex/issues/44847", "https://github.com/openai/codex/issues/45512"],
      name: { ja: "Codex 公式フィードバック（/feedback）", en: "Codex official feedback (/feedback)" },
      instructions: {
        ja: ["Codex CLI / Desktop で `/feedback` を入力してフィードバックダイアログを開きます。", "準備した本文を貼り付けます。ログを含めるかは自分で選択します（既定: 含めない）。", "送信結果の成功表示を確認したら、ErrorRelay で「送信した」を記録してください。"],
        en: ["Type `/feedback` in Codex CLI / Desktop to open the feedback dialog.", "Paste the prepared text. Choose yourself whether to include logs (default: no).", "After the success confirmation, mark the report as sent in ErrorRelay."],
      },
      caveats: {
        ja: ["2026-09 時点で、ログ無しの /feedback が通常チャットとして送られる不具合報告があります（openai/codex#44847）。成功表示が出ない場合は GitHub Issue へ切り替えてください。", "Desktop では /feedback が見つからない報告があります（#45512）。"],
        en: ["As of 2026-09, /feedback without logs was reported to post as a normal chat message (openai/codex#44847). If no success message appears, switch to the GitHub issue route.", "On Desktop, /feedback may not be discoverable (#45512)."],
      },
      products: ["codex_cli", "codex_desktop", "codex_ide"],
      options: { kind: "codex_feedback" },
    },
    {
      adapterId: "github_issue_codex",
      enabled: true,
      capability: "INTERACTIVE_HANDOFF",
      officialUrl: "https://github.com/openai/codex/issues/new/choose",
      verifiedAt: "2026-09-30",
      sourceUrls: ["https://github.com/openai/codex/tree/main/.github/ISSUE_TEMPLATE", "https://github.com/openai/codex/blob/main/docs/contributing.md"],
      name: { ja: "GitHub Issue（openai/codex）", en: "GitHub issue (openai/codex)" },
      instructions: {
        ja: ["先に既存 Issue を検索し、同じ問題があればそちらにコメントします。", "「Issue を開く」で公式テンプレートに入力済みの画面が開きます。GitHub へのログインが必要です。", "secret / ログ内の個人情報が無いことを確認して Submit します。"],
        en: ["Search existing issues first; comment on a duplicate instead of opening a new one.", "'Open issue' opens the official template prefilled. You need to be signed in to GitHub.", "Verify there are no secrets or personal data, then submit."],
      },
      caveats: {
        ja: ["Issue は公開されます。機密情報を含めないでください。", "セキュリティ脆弱性は Issue ではなく SECURITY.md の手順で報告します。", "DIRECT 送信は既定で無効です（GitHub token を設定し、明示承認した場合のみ）。"],
        en: ["Issues are public. Do not include confidential data.", "Security vulnerabilities go through SECURITY.md, not issues.", "DIRECT posting is disabled by default (requires a token and explicit approval)."],
      },
      products: ["codex_cli", "codex_desktop", "codex_ide"],
      options: { kind: "github_issue", owner: "openai", repo: "codex", templateCli: "3-cli.yml", templateApp: "1-codex-app.yml", templateExtension: "2-extension.yml", templateBug: "4-bug-report.yml" },
    },
    {
      adapterId: "generic_email",
      enabled: true,
      capability: "INTERACTIVE_HANDOFF",
      officialUrl: null,
      verifiedAt: "2026-09-30",
      sourceUrls: [],
      name: { ja: "メールで送る（宛先は自分で指定）", en: "Send by email (you choose the recipient)" },
      instructions: { ja: ["メールアプリが開きます。宛先を確認して送信してください。"], en: ["Your mail app opens. Check the recipient and send."] },
      caveats: { ja: ["添付は手動で追加します。"], en: ["Attachments must be added manually."] },
      products: ["*"],
      options: { kind: "generic_email" },
    },
    {
      adapterId: "export",
      enabled: true,
      capability: "EXPORT_ONLY",
      officialUrl: null,
      verifiedAt: "2026-09-30",
      sourceUrls: [],
      name: { ja: "ファイルに書き出す", en: "Export to files" },
      instructions: { ja: ["TXT / Markdown / JSON / ZIP を保存します。"], en: ["Save as TXT / Markdown / JSON / ZIP."] },
      caveats: { ja: [], en: [] },
      products: ["*"],
      options: { kind: "export" },
    },
  ],
};
