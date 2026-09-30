# RELEASE_CHECKLIST（販売前の人間確認事項）

## A. 公式資料の再確認（必須）
- [ ] help.openai.com 6614161（Support 連絡方法）を直接開き、SOURCE_NOTES §1 と一致するか確認
- [ ] help.openai.com 7996703（Troubleshooting）を直接開き、推奨項目 / HAR 手順を確認 → `docs/buyer/ログを添付する前に.txt` 更新
- [ ] developers.openai.com plugins（quickstart / build/mcp-server / deploy/submission / deploy/app-review / plugin-guidelines）を直接確認
- [ ] Codex 最新版で `/feedback` と `codex doctor --json` の挙動を確認（#44847 修正状況）→ `config/channels.json` の caveats 更新
- [ ] status.openai.com の JSON feed 有無 → あれば `ERRORRELAY_STATUS_FEED_URL`
- [ ] `config/channels.json` の各 `verifiedAt` を更新

## B. セキュリティ / プライバシー
- [ ] `ERRORRELAY_TOKENS` / `ERRORRELAY_SIGNING_SECRET` / `ERRORRELAY_BLOB_KEY` を本番値に
- [ ] `npm audit` を確認し runtime 依存に High 以上が無い
- [ ] retention 日数とバックアップ方針を PRIVACY.md に反映
- [ ] ログに本文/画像/token が出ないことを本番ログで目視

## C. 実機テスト
- [ ] iPhone（Safari, PWA インストール, Photos から選択, 画像貼り付け, 黒塗り, ZIP 保存）
- [ ] Android（Chrome, 同上）
- [ ] Windows / macOS（Companion のクリップボード取り込み, codex-version, codex-doctor）
- [ ] 結果を TEST_REPORT.md に追記

## D. AI
- [ ] 実 provider で 5 枚以上のスクショを解析し observed/inferred の分離を確認
- [ ] AI OFF 状態で全フローが完了することを再確認

## E. Plugin 提出
- [ ] 公開 HTTPS で `/mcp` が動作、tool scan 成功
- [ ] `/.well-known/openai-apps-challenge` に verification token
- [ ] privacy policy / terms / support / website URL を公開（docs/submission/）
- [ ] verified identity、Apps Management write access
- [ ] tool description が実挙動と一致（特に submit_report）

## F. 販売
- [ ] 購入者向け資料（docs/buyer/）の内容が現行 UI と一致
- [ ] THIRD_PARTY_NOTICES.txt の依存 license 確認
- [ ] 「保証しない」文言（修正・閲覧・AI 改善）が UI と資料に存在
