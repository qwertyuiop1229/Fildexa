# ZipStage

ZIP・ローカルフォルダ・単体HTMLをブラウザでプレビューする。ブラウザ内で展開・コンパイルして、オリジンを隔離した iframe で実行する。アプリファイルはサーバーにアップロードしない。

- 配信には dist ディレクトリを使用。Node 24で node --test tests/archive.test.mjs を実行できる。
- ZIPは120 MiB、展開後300 MiB、1ファイル96 MiBまで。暗号化、分割ZIP、ZIP64は非対応。フォルダの選択には webkitdirectory、ドロップ時は利用できる場合にディレクトリエントリーAPIを使用。
- ZIPのルート、ラッパー、firebase.json の hosting.public、代表的な dist / public を判別。ファイルが存在するHTMLパスとシンプルな Firebase Hosting のリライトルールに対応。
- TypeScript、TSX、JSXはesbuild WASMでブラウザ内変換。ローカルモジュール、基本的なViteの静的ファイル・CSS・JSON・import.meta.envの定数を解決する。Viteサーバー、任意のプラグイン、HMR、プリプロセッサ、SSR、完全なnpmビルドは実行しない。必要時はローカルでビルドして成果物を開く。
- ソースでpackage.jsonの依存を使う場合、外部通信に加えてnpm CDNを明示的に有効にできる。プレビューのオリジン・CORS・CDN・各ライブラリの仕様は通常ブラウザと同様に適用される。
- 外部リソースとAPI通信は初期状態でCSPにより制限。ユーザーが許可した場合にHTTPSとWSSを使える。開発ツールはコンソール、DOM検索・表示、観測可能な通信、ソース閲覧、基本性能、localStorage・sessionStorageの表示を備える。接続に使われたIPやTLS情報、非公開ヘッダー、ブラウザ内部のデバッグ機能は取得できない。DNS候補は利用者が要求したときにCloudflareへドメイン名だけ問い合わせる。
- アプリのlocalStorageを、利用者が許可したプロジェクトだけ継続保存する。保存レコードは名前・公開フォルダ・HTMLの手がかりから区別し、設定から個別に削除できる。sessionStorageはプレビュー作業中のみ。Firebase認証のポップアップ／リダイレクト、PWAのインストール、IndexedDB、バックエンド処理はこのプレビューの対象外。
- dist/vendorに es-module-lexer と esbuild のライセンスを同梱。
