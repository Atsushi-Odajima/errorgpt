# ErrorRelay — エラーを伝わる報告にする

スクリーンショット・ログ・環境・再現手順を整理し、機密情報を確認してから不具合報告を書き出す支援ツールです。

> **実装ブランチ：`019-errorrelay`**。この既定ブランチのREADMEは製品の案内です。以下のソース・資料リンクと起動手順は、実装ブランチを参照します。

## できること

- 報告スキーマ、環境・日時・再現手順の整理
- privacy scannerとredaction、日英レポート・ZIP出力
- ローカルPWA、任意のサーバー・desktop companion・MCP

## 現在の範囲・制限

- OpenAI Support等への送信は通常、人がフォームで完了する引き渡し方式です。報告生成と実送信の成功は別の状態です。
- GitHub Issue等の直接送信は資格情報と明示確認がある場合のみ。サーバー利用には認証・暗号化・保管期限の設定が必要です。

## 実装の見どころ

**構成：** TypeScript、Node.js / Hono、PWA、MCP、Playwright。

- [019-errorrelay/packages](https://github.com/Atsushi-Odajima/errorgpt/tree/019-errorrelay/019-errorrelay/packages)
- [019-errorrelay/apps](https://github.com/Atsushi-Odajima/errorgpt/tree/019-errorrelay/019-errorrelay/apps)
- [019-errorrelay/tests](https://github.com/Atsushi-Odajima/errorgpt/tree/019-errorrelay/019-errorrelay/tests)

## ローカルで試す

Node.js 22.13以上。ローカルPWAから試す手順で、サーバー配備や外部送信は不要です。

実装ブランチを取得し、次のディレクトリで作業します。

```sh
git clone --branch 019-errorrelay https://github.com/Atsushi-Odajima/errorgpt.git
cd errorgpt/019-errorrelay
npm install
npm run build
npm run preview -w apps/pwa
```

環境設定・初期化の詳細：[セットアップ手順](https://github.com/Atsushi-Odajima/errorgpt/blob/019-errorrelay/019-errorrelay/README.md)。

## 検証方法

`019-errorrelay/` の `package.json` に定義された主な確認コマンドです。DB・ブラウザ・外部ツールを要するものは、開発手順の事前設定が必要です。

```sh
npm run typecheck
npm run test
npm run test:e2e
npm run build
```

試験の実施環境・結果・未実施項目は、下記の記録を参照してください。画面エミュレーションと実機確認、モックと外部サービスでの確認を区別しています。

## 資料

- [019-errorrelay/README.md](https://github.com/Atsushi-Odajima/errorgpt/blob/019-errorrelay/019-errorrelay/README.md)
- [019-errorrelay/docs/NEXT_STEPS.txt](https://github.com/Atsushi-Odajima/errorgpt/blob/019-errorrelay/019-errorrelay/docs/NEXT_STEPS.txt)
- [019-errorrelay/docs/DEVELOPMENT.md](https://github.com/Atsushi-Odajima/errorgpt/blob/019-errorrelay/019-errorrelay/docs/DEVELOPMENT.md)
- [019-errorrelay/docs/TEST_REPORT.md](https://github.com/Atsushi-Odajima/errorgpt/blob/019-errorrelay/019-errorrelay/docs/TEST_REPORT.md)
- [019-errorrelay/docs/RELEASE_CHECKLIST.md](https://github.com/Atsushi-Odajima/errorgpt/blob/019-errorrelay/019-errorrelay/docs/RELEASE_CHECKLIST.md)
- [019-errorrelay/docs/DECISIONS.md](https://github.com/Atsushi-Odajima/errorgpt/blob/019-errorrelay/019-errorrelay/docs/DECISIONS.md)
- [019-errorrelay/docs/SECURITY.md](https://github.com/Atsushi-Odajima/errorgpt/blob/019-errorrelay/019-errorrelay/docs/SECURITY.md)
- [019-errorrelay/docs/OPERATIONS.md](https://github.com/Atsushi-Odajima/errorgpt/blob/019-errorrelay/019-errorrelay/docs/OPERATIONS.md)
- [画面資料](https://github.com/Atsushi-Odajima/errorgpt/tree/019-errorrelay/019-errorrelay/docs/screenshots)

## 制作・利用条件

制作・管理：**Atsushi Odajima**。実装・資料作成にはAI支援を利用しています。
ソース・同梱ライブラリ・フォント・モデル等の利用条件は、各ライセンスと第三者表記を参照してください。リポジトリの閲覧可能性と、再配布・商用利用の許諾は別です。
