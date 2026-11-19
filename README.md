# ZipStage

日本語の、ブラウザ内で動く ZIP Web プレビュー。ZIP はサーバーへ送らず、sandbox 付き iframe でプレビューする。デモの ZIP はテスト用のオリジナル素材。

- サイトのコピーを配信するには dist ディレクトリを静的ホストで提供する。
- テストは node --test tests/archive.test.mjs。
- 対応入力は ZIP または単体 HTML。ZIP は 120 MiB まで、解凍後 300 MiB まで、1 ファイル 96 MiB まで。暗号化、分割 ZIP、ZIP64 は非対応。
- ZIP のルート、1 階層のラッパー、firebase.json の hosting.public、代表的な dist / public などを判別。Hosting リライトは、実ファイルに向かう単純な完全一致ルールまたは catch-all を補助。
- HTML、CSS、画像、古典的な JavaScript、一般的な JS モジュール、ZIP への相対またはルート相対の fetch/XHR に対応。ブラウザ側のストレージ互換層は開いているプロジェクトだけのメモリ内で動作。
- Firebase の POPUP / リダイレクト認証、PWA のインストール、IndexedDB、実オリジンに依存する API、バックエンドやビルドコマンドはプレビューで提供しない。一般的なファイル読み込みと、実ホストを同じにすることは別。
- 外部の画像や API へのアクセスは初期状態では CSP で制限。外部通信をオンにすると外部 API へのアクセスを試みるため、内容を把握している自分の ZIP を開くこと。
- dist/vendor の es-module-lexer のライセンスを同梱。
