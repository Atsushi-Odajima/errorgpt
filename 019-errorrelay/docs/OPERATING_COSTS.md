# OPERATING_COSTS（概算、2026-09 時点の一般的な相場。契約前に各社の最新価格を確認）

| 項目 | 個人/小規模（〜100 report/月） | 小チーム（〜2,000 report/月） |
|---|---|---|
| ホスティング（1 vCPU / 1 GB VPS または小型コンテナ） | 約 $5–7/月 | 約 $12–25/月 |
| ドメイン + TLS | 約 $10–15/年（TLS は Let's Encrypt 無料） | 同左 |
| ストレージ（スクショ平均 0.5 MB × retention 30 日） | 数十 MB → VPS 内で吸収 | 〜1–2 GB → VPS 内 or object storage 約 $0.1/月 |
| AI vision（任意、OFF 可）| 画像 1 枚 + JSON ≈ 2–4k token。1 report ≈ $0.01–0.03 → 約 $1–3/月 | 約 $20–60/月 |
| バックアップ | VPS スナップショット 約 $1–2/月 | 同左 |
| **合計** | **約 $6–12/月**（AI OFF なら約 $5–8） | **約 $35–90/月** |

- PWA ローカルモードのみで使う場合: 静的ホスティング（GitHub Pages / Cloudflare Pages 無料枠）で **$0**。
- ChatGPT Plugin 公開: OpenAI 開発者アカウントの verified identity が必要（費用は OpenAI の現行規定を確認）。
- 監視/エラー通知を SaaS で行う場合は別途（無料枠で足りる規模）。
- 人的コスト: 公式経路の四半期ごとの再確認（SOURCE_NOTES §7）に 1–2 時間/回。
