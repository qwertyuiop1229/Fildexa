# Fildexa

ZIP・ローカルフォルダ・単体HTMLをブラウザでプレビューする。ブラウザ内で展開・コンパイルして、オリジンを隔離した iframe で実行する。アプリファイルはサーバーにアップロードしない。

- 配信には dist ディレクトリを使用。Node 24で node --test tests/archive.test.mjs を実行できる。
- ZIPは120 MiB、展開後300 MiB、1ファイル96 MiBまで。暗号化、分割ZIP、ZIP64は非対応。フォルダの選択には webkitdirectory、ドロップ時は利用できる場合にディレクトリエントリーAPIを使用。
- ZIPのルート、ラッパー、firebase.json の hosting.public、代表的な dist / public を判別。ファイルが存在するHTMLパスとシンプルな Firebase Hosting のリライトルールに対応。
- TypeScript、TSX、JSXはesbuild WASMでブラウザ内変換。ローカルモジュール、基本的なViteの静的ファイル・CSS・JSON・import.meta.envの定数を解決する。Viteサーバー、任意のプラグイン、HMR、プリプロセッサ、SSR、完全なnpmビルドは実行しない。必要時はローカルでビルドして成果物を開く。
- ソースでpackage.jsonの依存を使う場合、外部通信に加えてnpm CDNを明示的に有効にできる。プレビューのオリジン・CORS・CDN・各ライブラリの仕様は通常ブラウザと同様に適用される。
- 外部リソースとAPI通信は初期状態でCSPにより制限。オフの時に判別できる外部スクリプトや静的モジュールの依存先はリクエスト前に停止し、通信パネルに記録する。ユーザーが許可した場合にHTTPSとWSSを使える。開発ツールはコンソール、DOM検索・表示、観測可能な通信、ソース閲覧、基本性能、localStorage・sessionStorageの表示を備える。接続に使われたIPやTLS情報、非公開ヘッダー、ブラウザ内部のデバッグ機能は取得できない。DNS候補は利用者が要求したときにCloudflareへドメイン名だけ問い合わせる。
- アプリのlocalStorageを、利用者が許可したプロジェクトだけ継続保存する。保存レコードは名前・公開フォルダ・HTMLの手がかりから区別し、設定から個別に削除できる。sessionStorageはプレビュー作業中のみ。Firebase認証のポップアップ／リダイレクト、PWAのインストール、IndexedDB、バックエンド処理はこのプレビューの対象外。
- dist/vendorに es-module-lexer と esbuild のライセンスを同梱。

- スプリッターは1pxの境界線で表示し、マウスとタッチに広いヒット領域を設ける。左右ペイン幅、下部開発ツールの高さ、右配置時の幅はブラウザに記憶する。キーボードでは矢印キーを使用できる。
- プレビューを閉じると展開中の処理を中止し、実行中のページ、ログ、通信許可をリセットする。保存を有効にして記録したデータには触れない。
- 外部通信は安全な隔離と独立した設定。ゲーム操作をオンにするとポインターロックだけを許可する。ブラウザとユーザー操作の制約は残る。相対パスを指定した Request オブジェクトはZIP内のファイルを読める。

## 実行環境の選び方

| 環境 | 向いていること | 残る制約 |
|---|---|---|
| ChatGPT Site／Firebase Hosting の隔離プレビュー | ZIP・フォルダで画面と操作を確認、組み込みのコンソール、通信の確認 | FirebaseのGoogleログイン、ネイティブのIndexedDB／Service Workerは対象外 |
| Fildexa Local | 別オリジンで、元のURL構造・ページ遷移・ネイティブのブラウザAPIを確認 | ユーザーが信頼するアプリのみ。ブラウザ権限・CORS・認証設定は通常どおり |
| Firebase Hostingのテストサイト | Googleログイン、リダイレクト、PWA、スマホからの端末間テスト | テスト用Firebaseプロジェクトを設定。Hostingだけではバックエンドは切り替わらない |

公開・テストURLは、公開済みの HTTPS のURLをFildexaに入れて表示する機能です。サイトが埋め込みを禁止している場合や、Googleのリダイレクトが止まる場合は「別タブで開く」を使ってください。認証情報・Cookie・通信内容はFildexaから読み取りません。

### Windows/macOS/Linuxでローカル互換モード

1. このZIPを解凍して、`server.mjs` が見えるフォルダでターミナルを開く。
2. Node.js 22以上で `node server.mjs` を実行。ブラウザで `http://127.0.0.1:4175/` を開く（`localhost` ではなく、表示されたURLを使う）。
3. 自分のアプリの公開用フォルダかZIPを開き、**動作モード・互換性 → 信頼するアプリを起動**。外部通信が必要なアプリは、アプリ自身の設定に従って接続する。ログインやJavaScriptの標準開発ツールを使うときは「別タブで開く」。
4. 終わったら「プレビューを閉じる」またはCtrl+C。プレビューを閉じると配信を停止する。未停止の場合も1時間でセッションが切れる。公開サービスとしてこのNodeサーバーを使わない。

通常モードではホスト名・ポートはセッションごとに別になり、認証状態などは次のセッションに引き継がれません。配信データはPCのメモリ上だけ。プレビューしたコードをサーバー上では実行しません。Nodeの追加ライブラリは不要です。

### Googleログインを試す

1. Firebase AuthenticationのGoogleプロバイダを有効化した**テスト用プロジェクト**を用意し、実際に読み込むアプリのFirebase設定をテスト用にする。
2. Firebase Authenticationの承認済みドメインに `localhost` を登録する。最近作成されたプロジェクトには初期設定で入っていない場合があります。
3. PC版を `node server.mjs --auth-localhost` で起動すると、互換プレビューは `http://localhost:4176/` になります。通常のGoogleログインボタンを押す。ポップアップや認証の保存がブラウザの埋め込み制限で止まる場合は「別タブで開く」を使う。
4. 固定アドレスは1つの信頼できるアプリ専用です。同じアドレスの保存データやService Workerはブラウザに残るので、別アプリを試すときは通常モードまたは別ブラウザプロファイルを使う。Googleクライアントシークレット、サービスアカウント、認証トークンはFildexaに入れない。
5. リダイレクト認証は、テスト用Firebase Hosting上でFirebase公式手順に従って `authDomain` と認証ハンドラを構成する。ローカルサーバーは `/__/auth/` を代理配信しない。

CovoとAstro-FrayはGitHub上で公開フォルダが `public/`。生成済みファイルが必要なら、そのリポジトリ本来のビルドを先に実行。FlickMemoとcalendasksは `npm run build` 後の `dist/` を開く。アプリ自体のビルドや Firebase 設定はFildexaが書き換えません。

### Firebase Hostingへの公開

ZIP直下の `firebase.json` が `dist/` をHostingの公開先に指定しています。対象プロジェクトを確認してから以下を実行。公開版の機能は静的ホスティングだけで動きます。Node版のローカル互換モードはPC用のままで、Firebase Hostingには置かれません。

```sh
npx -y firebase-tools@latest login
npx -y firebase-tools@latest deploy --only hosting --project fildexa
```

将来、クラウド側にも「認証まで試せるプレビュー」を作るなら、Fildexa本体と別ドメインに認証付きのプレビュー配信を用意し、アプリごとに分離されたホスト・期限・容量を決める。Firebase Hostingは本体、Cloud Run等は必要になった場合だけプレビュー配信に分ける。OAuth設定はアプリ所有者が管理し、本番バックエンドを自動接続しない。

### 参考

- https://firebase.google.com/docs/auth/web/google-signin
- https://firebase.google.com/docs/auth/web/redirect-best-practices
- https://firebase.google.com/docs/hosting/test-preview-deploy

## 検証ラボ

「検証ラボ」には、今開いているプレビュー向けの機能をまとめています。

| タブ | できること |
| --- | --- |
| 診断 | ファイル不足・CSP・エラーの切り分け、現在の1ページの簡易チェック、短時間のフレーム計測、リンク先・小さな操作領域・コントラストの確認、匿名化したJSON出力 |
| ファイル | Markdown、JSON、CSV・TSV、画像・SVG、PDF、音声・動画、フォント、glTF・GLBの簡易形状、ソース、OpenAPI。ファイル単体・ZIP・フォルダに対応 |
| 比較 | 今の版を固定して新しいZIPを開き、同じビューポートで左右を比較。左右の保存領域は独立。ログ・エラー・通信件数・ファイルの追加・削除・内容変更を表示 |
| テスト | `fetch` の遅延・JSONモック、外部通信のオフライン条件、日時と既定の表示タイムゾーン・言語、手順チェックリスト、CSSセレクターでの可視性確認 |
| 接続 | GitHubのリポジトリ・ブランチ・PRのZIPを取得する導線、端末テスト用QRコード、自分の開発サーバーを開く、対応ブラウザでフォルダの自動追従 |

ファイル閲覧は元のファイルを書き換えません。比較とAPIモックは隔離プレビューの機能です。比較は外部通信を切った状態で起動します。ファイル名とサイズは全件、同サイズのファイルは読み込み上限32 MB（前後の合計）まで内容を照合し、照合できなかった件数も表示します。ページを移動しても、左右それぞれの一時保存は別々に維持します。モックは相対URLまたは同じアプリのパスへの `fetch` が対象で、外部サービスやXHRを書き換えません。YAMLのOpenAPI表示は基本的なマッピングと応答例を対象にし、外部参照を読み込みません。glTF・GLBは形状を確認するための表示で、テクスチャ・ボーン・アニメーションを再現しません。PDF・音声・動画の表示はブラウザの対応形式に依存します。

Vue・Svelte・Astro・Next.jsやGame EngineのWeb出力など、外部ビルドや専用ランタイムを使うアプリは静的出力を開くか、既に動かしている開発用URLを使います。Fildexaは任意のnpmスクリプトやサーバープログラムを自動実行しません。実際のGoogleログイン・PWA・IndexedDBは検証用HTTPSを別タブで開いて試します。Firebaseのテストアカウントには、アプリからエミュレーターに接続する設定が必要です。

iPad Safariではファイル選択・ZIP・タッチ操作を想定しています。フォルダ選択または自動追従が環境により選べない場合でも、ファイルアプリでZIPにまとめて開けます。Resize・分割バーはPointer Eventsを使い、動きを減らす設定も尊重します。

配布ZIPから起動するときは `node server.mjs` を実行します。Firebase Hostingでは同梱の `firebase.json` が `dist/` を公開用に指定します。Git管理のソースでは `node --test tests/*.test.mjs` で回帰テストを実行できます。

## 移行元と今後の開発

- [開発ロードマップ](docs/roadmap/README.md)
- 旧ZipStageの公開v8はローカルのGitタグ `zipstage-v8` に保存しています。
