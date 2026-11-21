# SheetJS Community Edition

公式配布版 SheetJS CE 0.20.3 の xlsx.mjs を同梱しています。Apache License 2.0 は LICENSE に記載しています。

FildexaではワークシートXMLの読み込み部分を変更し、数式の保存結果が欠けているセルを数値の0として扱わないようにしました。結果が空文字として記録されている場合は、その値を保持します。

https://docs.sheetjs.com/docs/getting-started/installation/standalone/
