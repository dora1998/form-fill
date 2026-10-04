# 開発・検証の手順

## 固定ダミー情報による最小実装

Safariのポップアップで「このページを解析」→入力予定値を確認→「ダミー情報を入力する」。姓名・カナ・郵便番号・住所を対象に、明確なラベルとautocompleteはルール、曖昧な欄はFoundation Modelsの構造化出力で分類する。値は `Shared/FillPlan.swift` の固定プロフィールから合成し、モデルへ渡さない。保存・編集UIは未実装。

ダミー値は山田 太郎、ヤマダ タロウ、1000001、東京都、千代田区、千代田、1-1、テストマンション101号室。実在する本人の情報ではない。入力時にはサイトへ値が渡る。フォームの送信は行わない。

表示中・編集可能な標準input（text/number/search）、textarea、単一selectをトップレベル文書から最大40欄抽出する。既存入力は保持し、都道府県は選択肢に一致した場合だけ選ぶ。文字数・patternに合わない値や不明な欄は保留する。パスワード・メール・電話・支払情報、iframe、Shadow DOM、カスタムドロップダウンは対象外。

プレビュー後に欄・ラベル・値・URL・要素順序が変われば再解析を求める。実行中にサイト側の補完が別の欄を変更した場合、その欄は上書きせず保留する。標準value setterとinput/changeイベントで入力し、結果を読み戻す。非同期処理の完了をすべて保証するものではないため、最終値はページ上で確認する。

Apple Intelligence対応端末・iOS 26以降が必要。モデル未有効化・未準備・利用不能なら解析を保留する。推論の一部が失敗した場合は、ルールと成功したバッチで判定した欄だけ提示する。解析は4欄ずつの小さなバッチで行い、45秒経過後は次のバッチを開始しない。ポップアップは60秒で待機を終了する。実行中の推論そのものを強制停止する実装は含まない。

## ビルドとiPhoneでの試し方

```sh
xcodegen generate
open FormFill.xcodeproj
```

Xcode 26以降でFormFill schemeを選択し、アプリ・拡張に自分のTeamを設定してiPhoneへインストールする。`project.yml` が構成の正本。Bundle IDを変更する場合は `background.js` のnative message送信先とテストも合わせる。

1. 設定 → アプリ → Safari → 機能拡張 → Form Fillを有効にする。
2. Macでリポジトリのルートから `python3 -m http.server 8000 --bind 0.0.0.0` を実行する。
3. 同じネットワークのiPhoneで `http://<MacのLANアドレス>:8000/Fixtures/japanese-address.html` を開く。
4. Safariの拡張メニューでForm Fillを開き、サイトアクセスを許可する。
5. 「このページを解析」を押し、9欄の予定値を確認する。都道府県のプレビューは東京都、実際のselectのvalueは13。
6. 「ダミー情報を入力する」を押し、ページ上の値を確認する。繰り返し解析すると既存入力として保留される。
7. `Fixtures/address-variants.html` で分割郵便番号・ひらがな・住所1/2・一体欄・保留項目を検証する。期待値はページに記載している。
8. 実際の複数サイトで同じ操作を試し、サイト・欄ラベル・期待値・実際の値・ルール/モデル・処理時間・保留理由を記録する。ダミー値のままフォームを送信しない。

「このページで疎通を確認」はネイティブhealthと入力欄数の診断。「拡張からローカルモデルを確認」は固定文だけの推論診断。アクセス失敗と推論失敗の切り分けに使う。

## 自動検証

Node.js 24以降、Python 3、macOSではSwiftを使用する。

```sh
npm test
npm run check
swiftc Shared/FillPlan.swift Tests/Native/main.swift -o /tmp/fill-planner-tests
/tmp/fill-planner-tests
xcodebuild -project FormFill.xcodeproj -scheme FormFill \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

`Tests/Browser/autofill.cjs` はPlaywrightと対応するWebKitのある環境で `node Tests/Browser/autofill.cjs` として実行する（任意の追加検証）。リポジトリにはnpm依存を追加していない。必要なら一時ディレクトリにPlaywrightを用意し、`NODE_PATH` と `PLAYWRIGHT_BROWSERS_PATH` を指定する。`WEBKIT_EXECUTABLE` で実行ファイルを指定することもできる。WebKitで実際のDOMとポップアップの一連の操作を検証し、ネイティブ分類応答はモックする。Safariの拡張権限・ネイティブ通信・Foundation Models推論は実機で別途確認する。

## 検証結果（2026-10-04）

| 検証 | 環境 | 結果 |
| --- | --- | --- |
| `npm test` | macOS / Node.js 24.12.0 | 疎通・安全な欄数検出・診断UIテスト成功 |
| `npm run check` | macOS / Python 3 | plist、manifest、権限、リソース参照成功 |
| Swift値合成・入力契約 | macOS / Swift | 姓名、ひらがな、住所、郵便番号、select、制約、既存値、要求検証成功 |
| XcodeGen・署名なしSimulatorビルド | macOS / Xcode 27.0 | 成功 |
| 実DOM入力とpopupフロー | Playwright / WebKit 26.5 | 成功（9欄入力、既存値保持、DOM変更・補完検出、イベント、制約、popupの解析→入力） |
| Safari拡張・基本9欄 | iPhone 17 Simulator / iOS 27.0 | ネイティブ連携、9欄のプレビュー・入力成功。Safari上で姓名・カナ・郵便番号・都道府県・市区町村の値を目視確認 |
| Safari拡張・分割フォーム | iPhone 17 Simulator / iOS 27.0 | Foundation Modelsによる郵便番号3/4桁の分類成功。16欄へ入力し、既存の姓・不明欄の2欄を保留。ひらがな、分割郵便番号、住所1/2、市区町村込み住所をページ上で目視確認 |
| 実サイト（詳細は下記） | iPhone 17 Simulator / iOS 27.0 | 公開フォーム3サイトで解析・入力を検証 |
| 実機での分類精度 | iPhoneが必要 | 未実行 |

CIにはNode/Python検証と、macOSのSwift値合成テスト・XcodeGen・署名なしSimulatorビルドを定義している。

Foundation ModelsのAPIは[構造化生成API](https://developer.apple.com/documentation/foundationmodels/languagemodelsession/respond(to:generating:includeschemainprompt:options:)-13kji)と[WWDC25解説](https://developer.apple.com/videos/play/wwdc2025/301/)を参照。拡張内での推論時間・メモリ・オフライン・分類精度は実機で確認する。

## シミュレーターでの確認

Apple Intelligence対応Macでモデルが準備できていれば、Foundation ModelsはiOSシミュレーターからも実行できる（[Appleの案内](https://developer.apple.com/forums/thread/787445)）。この環境ではiPhone 17 / iOS 27.0のSafariで実際の拡張を起動し、基本9欄の入力が成功した。Xcode 27ではシミュレーター表示アプリがDevice Hubになっている。

Simulator用ビルド後、`xcrun simctl install booted <ビルド先>/FormFill.app` でインストールできる。フォームはMacの `http://127.0.0.1:8000/Fixtures/japanese-address.html` をシミュレーターのSafariから開ける。ポップアップが小さい場合、シート上部を上へドラッグして広げ、内側をスワイプして入力ボタンへ移動する。

分割フォームの初回検証では、モデルが「住所1（町名・番地）」を町名のみと分類し、番地が抜けた。明示された住所要素の組み合わせをルールで優先するよう修正し、Swiftの回帰テスト3件を追加。再ビルド・再インストール後、Safari上で「千代田1-1」「千代田区千代田1-1」を確認した。モデルの動作は確認できたが、任意サイトの曖昧な住所ラベルの精度は引き続き検証対象。

## 実サイトでの精度確認（2026-10-04）

iPhone 17 Simulator / iOS 27.0のSafariで公開お問い合わせフォームを使用。固定の架空プロフィールでプレビューを確認してから入力した。問い合わせの送信・確認画面への遷移・同意操作はしていない。対象は姓名・カナ・郵便番号・住所で、メール・電話・問い合わせ内容は対象外。

初回の問題は、でん六の姓／名がlabel要素ではなくspanであるため抽出されず、姓に太郎・名カナにヤマダを提案したこと、分割郵便番号を全文7桁として保留したこと。シーサイドラインでは姓名・カナ・郵便番号の5欄のみ入力でき、住所・建物名を判定できなかった。Rilaではカナを漢字として提案し、tel型の郵便番号を見落とし、市区町村の例が町名まで含むのに町名を省略した。誤ったプレビューは適用していない。

共通修正として、近接span・table見出し・dlのdt・field見出しを長さ制限付きで抽出し、カナの親見出しを参照する。郵便番号と明示されたtel欄のみ対象に加え、3/4桁の郵便番号をルールで判定する。住所の明示的な要素一覧・「市区町村郡以降」・入力例の市＋区＋町を値合成に反映。ホスト名やサイト固有の入力名に対する対応表は使っていない。WebKitの構造抽出テストとSwiftの回帰テストを追加した。

再検証の途中、でん六の電話欄をモデルが住所と分類した（文字数制限で保留され、入力はされなかった）。電話・メール・会社・件名・問い合わせ・検索と明示された欄は分類前にunknownとして除外するよう修正し、Swiftで4件検証した。

| サイト | 対象欄 | 修正後の結果 |
| --- | --- | --- |
| [でん六](https://form.denroku.co.jp/a.p/101/) | 姓名2・カナ2・分割郵便2・県・住所 = 8 | 8欄入力保持、適用時の保留0。100/0001、東京都、町名・番地・建物を含む住所を目視確認。電話・メール・内容は空欄 |
| [シーサイドライン](https://www.seasideline.co.jp/guidance/contact_us/sl_contact.php) | 姓名2・カナ2・郵便・県・市区町村番地・建物 = 8 | 都道府県上書き対応後、8欄入力保持、適用時の保留0。初期値の神奈川県を東京都に上書きし、ページ上で住所と一致を確認 |
| [Rila](https://rila.co.jp/contact/) | 姓名2・カナ2・郵便・県・市区町村町名・番地・建物 = 9 | 8欄入力保持、県1欄をサイト変更として保留。サイト補完された東京都を含む9欄がページ上で期待値と一致 |

Rilaの再検証では9欄を正しくプレビューし、8欄の入力保持を拡張側で確認。残る都道府県は郵便番号入力後のサイト補完で変更されたため上書きを保留した。ページ上では東京都を含む9欄の期待値を確認できた（姓名・カナ・1000001・東京都・千代田区千代田・1-1・建物名）。

これらは同じサイトで問題を修正して再確認した結果であり、未見サイトへの一般的な精度やモデル単独の精度を示すものではない。明示ラベルはルール優先、曖昧な項目はFoundation Modelsで分類する。モデルは住所の一部を落とすことがあり、プレビューの目視確認が必要。

追加の要望により、都道府県の選択欄は既存の初期値があっても上書きする方針に変更。複数の正式な都道府県名を含むselectに限定し、プレビューのprefecture分類とDOMの選択肢を確認して適用する。ほかの既存入力・選択は保持する。プレビュー後の手動変更や、適用途中のサイト補完は引き続き保留する。SwiftとWebKitで初期値上書き・他欄の保持・プレビュー後の変更を検証した。

再ビルド・再インストール後、シーサイドラインのSafariフォームで8欄のプレビュー・入力成功を確認。都道府県は初期値「神奈川県」から「東京都」へ変わり、郵便番号1000001・千代田区千代田1-1・建物名と整合した。フォームは送信していない。
