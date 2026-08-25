# 第三者ライセンス・出典

## 実行時ライブラリ

公開版はHTML、CSS、ブラウザ標準API、Vanilla JavaScriptだけで動作し、第三者JavaScriptライブラリやWebフォントを読み込みません。

## データ

地理・問題データはアプリのMIT Licenseの対象外です。各データの出典、加工内容、利用条件は [DATA_SOURCES.md](DATA_SOURCES.md) を参照してください。

都道府県境界はNatural Earth v5.1.2の「Admin 1 – States, Provinces」を加工しています。Natural Earthの地図データは[パブリックドメイン](https://www.naturalearthdata.com/about/terms-of-use/)で、改変・再配布・商用利用に許諾や表示を必要としません。本アプリでは任意のクレジットとして「Made with Natural Earth」を表示します。

## 開発・公開

GitHub Actionsでは次の公式Actionを利用します。これらは公開サイトへ配信されません。

- [`actions/checkout@v5`](https://github.com/actions/checkout/tree/v5)（[MIT License](https://github.com/actions/checkout/blob/v5/LICENSE)）
- [`actions/setup-node@v5`](https://github.com/actions/setup-node/tree/v5)（[MIT License](https://github.com/actions/setup-node/blob/v5/LICENSE)）
- [`actions/configure-pages@v5`](https://github.com/actions/configure-pages/tree/v5)（[MIT License](https://github.com/actions/configure-pages/blob/v5/LICENSE)）
- [`actions/upload-pages-artifact@v4`](https://github.com/actions/upload-pages-artifact/tree/v4)（[MIT License](https://github.com/actions/upload-pages-artifact/blob/v4/LICENSE)）
- [`actions/upload-artifact@v7`](https://github.com/actions/upload-artifact/tree/v7)（[MIT License](https://github.com/actions/upload-artifact/blob/v7/LICENSE)）
- [`actions/deploy-pages@v4`](https://github.com/actions/deploy-pages/tree/v4)（[MIT License](https://github.com/actions/deploy-pages/blob/v4/LICENSE)）

各Actionのライセンスは、それぞれの配布元リポジトリに従います。上記のメジャーバージョン指定はGitHub Actionsの実行時に同系列の更新へ追従します。

性能検査には [`@lhci/cli@0.15.1`](https://github.com/GoogleChrome/lighthouse-ci/releases/tag/v0.15.1) を使用します。Lighthouse CIは [Apache License 2.0](https://github.com/GoogleChrome/lighthouse-ci/blob/v0.15.1/LICENSE) で提供されています。
