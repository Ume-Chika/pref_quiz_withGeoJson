# データ出典

公開データは、出典と利用条件を確認できるものだけを収録します。アプリ本体のMIT Licenseは、以下のデータには適用されません。

## 都道府県境界

- 公開用ファイル: `static/data/low_prefectures.geojson`
- 原典: Natural Earth v5.1.2「[Admin 1 – States, Provinces](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/)」（1:10m）
- 固定した入力: [`ne_10m_admin_1_states_provinces.geojson`](https://github.com/nvkelso/natural-earth-vector/blob/v5.1.2/geojson/ne_10m_admin_1_states_provinces.geojson)
- 取得日: 2026-08-24
- 利用条件: [パブリックドメイン](https://www.naturalearthdata.com/about/terms-of-use/)（許諾・表示不要、改変・電子配布・商用利用可）
- 入力SHA-256: `22d0e3ad85eb3e27f17cabf8ba2d50e554fbc27a87796ff891d958185da62fb5`

本リポジトリでは `scripts/build-boundaries.mjs` により、日本の47都道府県をISO 3166-2コードで抽出し、Douglas–Peucker法（許容差0.01度）による簡素化、約0.001平方度未満の小ポリゴン除外、座標の小数5桁化、都道府県コードと名称の付与を行いました。

出力は47件、87,425バイト、Polygon 33件、MultiPolygon 14件、118ポリゴン、3,911点です。範囲は `[122.93865, 24.25825, 145.82496, 45.51586]`、SHA-256は `b1c6c66f04a0a117174ee77174684d9e233ca91cdf87963d89a5e7910ed263fb` です。

表示: 「Made with Natural Earth（加工済み・学習用）」

Natural Earthの境界表現は縮尺に応じた概略で、加工時に小さな島も除外しています。測量、法務、行政判断には使えません。本アプリは原典の表現を踏襲し、領土や行政上の見解を独自に示すものではありません。

当初候補の国土交通省「国土数値情報 行政区域データ（N03）2026年版」はCC BY 4.0ですが、個別ページに国土地理院への二次利用申請などが必要な場合がある旨の注意があります。公開者へ追加手続きを残さないことを優先し、許諾・表示が不要と明記されたNatural Earthへ変更しました。

## 基礎問題データ

- 公開用ファイル: `static/data/prefecture_facts.json`
- 取得日: 2026-08-24
- 収録内容: 47都道府県のコード、名称、都道府県庁所在地、地方区分、郷土料理百選
- 加工内容: 各資料の表記を `code`、`name`、`capital`、`region`、`dish` に正規化

出典:

- 都道府県コード・名称: e-Stat「[都道府県一覧](https://www.e-stat.go.jp/stat-search/file-download?fileKind=2&statInfId=000007914937)」
- 都道府県庁所在地: 国土地理院「[都道府県と都道府県庁所在地](https://www.gsi.go.jp/common/000218164.pdf)」
- 地方区分: 内閣府「[地震防災対策の現状調査に係る住民アンケート結果](https://www.bousai.go.jp/jishin/nankai/taisaku_wg_02/11/pdf/sub1.pdf)」19ページの8区分
- 東京都庁の所在自治体: 東京都「[都庁への交通案内](https://www.metro.tokyo.lg.jp/about/kotsuannai)」
- 郷土料理: 農林水産省「[農山漁村の郷土料理百選一覧](https://www.maff.go.jp/j/study/syoku_vision/manual/pdf/meguji.pdf)」

地方区分には法令上の唯一の正解がないため、本アプリでは上記内閣府資料の8区分を採用します。中部は新潟県から愛知県、近畿は三重県を含み、九州は沖縄県を含む定義です。東京都庁所在地は所在自治体の「新宿区」とします。

名産・文化分野（E）は、主観的な「代表料理」を独自選定せず、農林水産省の郷土料理百選一覧で各都道府県の先頭に掲載された料理を統一基準として収録します。掲載地域以外では食べられない、または発祥地が一意であるという意味ではありません。出典を確認できない問題は公開版へ含めません。

## 学習方式の参考資料

- Lindseyほか, “Optimizing practice scheduling requires quantitative tracking of individual item performance” ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC7567101/))
- Mettlerほか, “A Comparison of Adaptive and Fixed Schedules of Practice” ([PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC6028005/))

これらは学習設計の参考資料です。収録データの出典ではありません。
