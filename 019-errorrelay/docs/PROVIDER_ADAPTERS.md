# PROVIDER_ADAPTERS

## Capability
| 値 | 意味 | UI 表示 |
|---|---|---|
| DIRECT | 公式の公開 write API / tool で送信可能。`send()` 実装、receipt 必須 | 「送信する」 |
| INTERACTIVE_HANDOFF | 公式 UI へ利用者を案内し、本文/添付を準備。最終送信は利用者 | 「準備完了にする」→「公式窓口を開く」「本文をコピー」「自分で送信した」 |
| EXPORT_ONLY | TXT/Markdown/JSON/ZIP 出力 | 「書き出し」 |
| UNAVAILABLE | config で disabled、または前提（token 等）不足 | 非表示/無効 |

DIRECT でないのに「自動送信」と表示しない（`executeSubmission` の message が capability 別）。

## Interface（`packages/core/src/adapters/types.ts`）
```ts
interface ProviderAdapter {
  id; capability(); info(): ChannelInfo; supports(report); prepare(report, lang, ctx): PreparedSubmission;
  send?(prepared, idempotencyKey): Promise<DirectSendResult>; // DIRECT のみ
}
```
`ChannelInfo` は name/instructions/caveats（ja/en）、officialUrl、verifiedAt、sourceUrls を持ち、config（`config/channels.json`）から読む。

## 実装
| adapterId | kind | capability(既定) | prefill |
|---|---|---|---|
| openai_support | openai_support | INTERACTIVE_HANDOFF | help.openai.com。formFields は 4 章の最低項目に対応 |
| codex_feedback | codex_feedback | INTERACTIVE_HANDOFF | `/feedback` の案内、logs は利用者選択 |
| github_issue_codex | github_issue | INTERACTIVE_HANDOFF（DIRECT は client 注入 + config） | `issues/new?template=3-cli.yml&version=…&actual=…&steps=…` |
| generic_email | generic_email | INTERACTIVE_HANDOFF | mailto: |
| (任意) | generic_webform | INTERACTIVE_HANDOFF | officialUrl を開く |
| export | export | EXPORT_ONLY | — |

未知の kind は generic_webform として読み込む（config だけで新経路追加可能）。

## 将来 Provider（Anthropic / Google / Microsoft 等）
1. 各社の利用規約・公式送信経路を確認（SOURCE_NOTES に追記）。
2. `channels.json` に entry 追加。DIRECT が本当に公開 API で可能な場合のみ `send()` 実装を持つ adapter class を追加し registry の `instantiate` に登録。
3. `products` に新 ProductId を追加する場合は schema の `ProductIdSchema` と `PRODUCT_LABELS` を拡張（minor version up）。
