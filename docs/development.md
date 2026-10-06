# 開発・検証の手順

## 実プロフィール対応（2026-10-06）

現在は実プロフィールを共有Keychainに保存し、Safari拡張のポップアップから認証して入力します。以下の過去の詳細ログ収録・ダミーのページ内入力の記述は検証履歴です。現行の利用方法はREADMEと[保存・認証設計](profile-security-design.md)を参照してください。

今回の検証: Xcode 27のDebug／Release・iOSシミュレーター向け署名なしビルド、Node 20件、strict型チェック、Swiftの値合成・保護フロー、WebKitの抽出・9欄入力・既存値／変更検知・通常診断の回帰テストが成功。配布物に詳細収録JavaScriptがないことを確認した。iPhone 17 / iOS 27シミュレーターで設定画面とOSの端末パスコード認証UI、キャンセル後に登録値を表示せずロック画面へ戻ることを確認した。

追加のシミュレーター確認では、署名を有効にしたDebugビルドをインストールし、Device HubのDevice > Face ID > EnrolledとAuthorized with Face IDを使用した。ホストアプリで認証成功→編集画面→架空プロフィールの入力→再認証→Keychain保存成功とロック画面への復帰を確認し、画面を撮影した。これは生体認証の成功イベントの模擬であり、実機の保護を検証したものではない。続けて、利用者が1日だけサイトアクセスを許可したhttpbin.org上の合成フォーム（標準autocomplete付き、送信ボタンなし）で、Safari拡張のFace ID成功→共有Keychain読出し→姓名・郵便番号・住所のプレビュー→再認証→3欄入力・0欄保留を確認した。撮影中の期限切れでは入力されず再解析が必要になることも確認。実機での認証・Keychainアクセスグループの保護・端末保護の確認は引き続き未完了。

シミュレーターのKeychain読出しだけでは認証画面が表示されなかったため、プレビュー・入力とも新しいLAContextでdeviceOwnerAuthenticationを明示的に評価してから、同じコンテキストで保護されたKeychain項目を読むようにした。KeychainのuserPresence保護は維持する。小さいSafariポップアップ向けに解析後の導入説明をたたみ、認証済みの確認ボタンを隠して候補と実行ボタンを見やすくした。修正後のDebugビルド、Swift保護フローテスト、Node 20件、strict型チェック、scaffoldチェック、WebKit入力回帰が成功した。

実機転送: 接続されたiPhone 17向けの署名付きDebugビルドとパッケージ検証に成功し、更新インストールを完了した。署名済みアプリと拡張のKeychainアクセスグループが一致することを確認した。実機Safari上の認証・入力は未検証。

追加のネイティブテスト:

```sh
swiftc Shared/FillPlan.swift Shared/Profile.swift Shared/ProfileRepository.swift SafariExtension/ProfileFillService.swift Tests/Native/profile-security.swift -o /tmp/profile-security-tests
/tmp/profile-security-tests
```

認証失敗、他origin、期限、二重入力、編集・削除、認証中のキャンセル、同時要求を合成プロフィールで検証します。このテストでは読み出しを差し替えているため、OS認証とKeychain自体は実機でも確認する必要があります。実機の値をテストやログに使わないでください。

署名には両ターゲットで同じKeychainアクセスグループが必要です。`project.yml` の `keychain-access-groups` と `ProfileKeychainAccessGroup` を揃えます。`NSFaceIDUsageDescription` は両ターゲットに設定済みです。アプリから保存→Safariから認証してプレビュー→入力、認証拒否・キャンセル、ロック復帰、パスコード変更／除去、再インストールを確認してから配布します。


## 固定ダミー情報による最小実装

Safariのポップアップで「このページを解析」→入力予定値を確認→「ダミー情報を入力する」。姓名・カナ・郵便番号・住所を対象に、明確なラベルとautocompleteはルール、曖昧な欄はFoundation Modelsの構造化出力で分類する。値は `Shared/FillPlan.swift` の固定プロフィールから合成し、モデルへ渡さない。アプリの設定画面で同じダミープロフィールを確認できる。編集・保存は未実装。

ダミー値は山田 太郎、ヤマダ タロウ、1000001、東京都、千代田区、千代田、1-1、テストマンション101号室。実在する本人の情報ではない。入力時にはサイトへ値が渡る。フォームの送信は行わない。

表示中・編集可能な標準input（text/number/search）、textarea、単一selectをトップレベル文書から最大40欄抽出する。プレビューに表示した対象欄は既存値も上書きする。selectは選択肢に一致した場合だけ選ぶ。文字数・patternに合わない値や不明な欄は保留する。パスワード・メール・電話・支払情報、iframe、Shadow DOM、カスタムドロップダウンは対象外。

プレビュー後に欄・ラベル・値・URL・要素順序が変われば再解析を求める。実行中にサイト側の補完が別の欄を変更した場合、その欄は上書きせず保留する。標準value setterとinput/changeイベントで入力し、結果を読み戻す。非同期処理の完了をすべて保証するものではないため、最終値はページ上で確認する。

Apple Intelligence対応端末・iOS 26以降が必要。モデル未有効化・未準備・利用不能なら解析を保留する。推論の一部が失敗した場合は、ルールと成功したバッチで判定した欄だけ提示する。解析は4欄ずつの小さなバッチで行い、45秒経過後は次のバッチを開始しない。ポップアップは60秒で待機を終了する。実行中の推論そのものを強制停止する実装は含まない。

## ビルドとiPhoneでの試し方

```sh
pnpm install --frozen-lockfile
pnpm build
xcodegen generate
open FormFill.xcodeproj
```

Xcode 26以降でFormFill schemeを選択し、アプリ・拡張に自分のTeamを設定してiPhoneへインストールする。`project.yml` が構成の正本。Bundle IDを変更する場合は `SafariExtension/Source/background.ts` のnative message送信先とテストも合わせる。

1. 設定 → アプリ → Safari → 機能拡張 → Form Fillを有効にする。
2. Macでリポジトリのルートから `python3 -m http.server 8000 --bind 0.0.0.0` を実行する。
3. 同じネットワークのiPhoneで `http://<MacのLANアドレス>:8000/Fixtures/japanese-address.html` を開く。
4. Safariの拡張メニューでForm Fillを開き、サイトアクセスを許可する。
5. 「このページを解析」を押し、9欄の予定値を確認する。都道府県のプレビューは東京都、実際のselectのvalueは13。
6. 「ダミー情報を入力する」を押し、ページ上の値を確認する。繰り返し解析しても対象欄を上書きでき、プレビューに上書き対象を明示する。
7. `Fixtures/address-variants.html` で分割郵便番号・ひらがな・住所1/2・一体欄・保留項目を検証する。期待値はページに記載している。
8. 実際の複数サイトで同じ操作を試し、サイト・欄ラベル・期待値・実際の値・ルール/モデル・処理時間・保留理由を記録する。ダミー値のままフォームを送信しない。

「このページで疎通を確認」はネイティブhealthと入力欄数の診断。「拡張からローカルモデルを確認」は固定文だけの推論診断。アクセス失敗と推論失敗の切り分けに使う。

## 認識できないページのデバッグ情報

### 詳細ログをファイルで添付する

1. Safari拡張の「開発用の詳細情報」で「次の解析で詳細を記録する」をチェックし、解析・入力する。
2. ページを再読み込みする前に「開発用データをアプリに保存」を押す。詳細情報のJSONを1件のファイルとして保存する。解析前でも現在のDOMを保存でき、収集失敗の場合はそのエラー記録を保存する。
3. Form Fillアプリを開き「保存したデバッグログ」を選ぶ。「ファイルに保存」で保存先を選ぶか、「共有」で添付先を選ぶ。アプリを開いたまま保存した場合は「更新」で一覧を再取得する。
4. 不要なログは一覧のスワイプ操作で削除する。

保存はボタン操作時だけ行い、1件20 MiB（UTF-8）まで。日時と対象ドメインを含むファイル名（同じ日時・ドメインで保存した場合は連番を付加。URL不明時はunknown-site）で複数の記録を保持し、ページ再読み込み・ポップアップ終了・アプリ再起動後も残る。自動削除はなく、保存件数が多い場合は手動で削除する。共有コンテナーの `DebugReports` フォルダーをバックアップ対象外に設定し、iOSでは完全ファイル保護を指定する。詳細ログの原文をそのまま保存するため、共有前に個人情報・認証情報を確認する。詳細ログのクリップボード・手動コピー導線は設けない。通常の匿名化した「デバッグ情報をコピー」は引き続き使える。

`xcodegen generate` により両ターゲットへApp Groups entitlementを設定する。実機のSigning & Capabilitiesで同じ `group.dev.formfill.app` がTeamのプロビジョニングに含まれることを確認する。固有のGroup IDへ変更する場合は `project.yml` の両entitlementsと `Shared/DebugReportStore.swift` の `groupID` を揃えて再生成する。App Group未設定・ストレージ不足・サイズ超過はポップアップへ保存失敗として表示する。

実機確認では、解析・入力後の保存、複数ログ、ページ終了後の取り出し、ファイル保存/共有先でのJSON内容、削除、App Group未設定時のエラーを確認する。

ポップアップで解析後に「デバッグ情報をコピー」を押す。解析前・対象欄なし・モデル利用不可・解析失敗でもコピーできる。ページアクセスに失敗した場合は `page.status: unavailable` を記録する。クリップボード書き込みだけの `clipboardWrite` 権限を使用し、自動コピーに失敗した場合は読み取り専用の欄を選択して手動コピーする。

JSONには拡張バージョン、トップ文書の欄数・対象欄数・iframe数、最大200欄の種類・表示状態・無効/読み取り専用状態・ラベル等の有無・文字数制限・選択肢数を含める。対象の先頭40欄には `f0` などの一時IDを付け、分類結果のkind・rule/model・固定コードの保留理由と対応づける。対象外の原因は `eligible` とtype・visible・disabled・readOnly・postalControlで切り分ける。iframe内・Shadow DOM内の欄は解析対象に含めない。

schemaVersion 2では `analysisFields` に解析時点の欄情報を記録する。label・ariaLabel・name・htmlID・placeholder・contextごとに存在の有無と固定の意味コードを載せる。例えば `municipality` は市区町村の手がかり、`example_prefecture` / `example_city_ward` / `example_town` / `example_number` は入力例に県・市区郡・町村/丁目・番地形式があることを表す。autocompleteは標準の許可したトークンだけを残し、任意のsection名などは出さない。これらは文字列のパターンから得た診断の手がかりで、正しい分類を保証しない。

`skipped` にもkindとsourceを記録し、分類済みだが既存値を保持した欄と未分類の欄を区別する。初期版の `not_classified_existing_input` は既存値のためモデル分類を行わなかった欄。classifierVersion 2以降は入力済みの欄もメタデータだけで分類する。classifierVersion 3以降は分類した姓名・住所欄の既存値も上書きし、プレビューと診断のoverwritesExistingに上書き対象を示す。現在のDOM取得に失敗しても解析時点の安全な情報をコピーし、`captureStatus` にタブ取得・スクリプト注入・応答形式のどこで失敗したかを記録する。

デバッグ構造は、メッセージ通信を介さず `scripting.executeScript` の返り値から直接取得する。古いページのメッセージハンドラーに依存しない。`collectorVersion` と `contentVersion` に収集処理と解析処理の版を記録する。更新前から開いていたページで解析する場合は、ページを再読み込みすると新しい処理へ確実に切り替わる。

`lastAnalysis.modelDiagnostics` にはモデルへ要求した欄数・試行バッチ数・失敗バッチの欄IDと固定の原因コードを記録する。context_limit・decoding_failure・guardrail_violation・refusal・rate_limited・deadline_exceeded等を区別し、使用されたコードの説明をlegendへ含める。例外のdescription、モデルの出力文、プロンプトや個人情報はコピーしない。モデルが要求した項目IDを欠落させた場合も `invalid_model_output` として記録する。placeholderの意味コードには住所3と数字7桁の手がかりも含める。

schemaVersion 3では、外部ユーザーから届いたJSONだけで対象と状態を把握できるよう、製品名・`summary`（日本語の診断要約）・`readingGuide`（読み方）・`legend`（使用した分類/意味コードの日本語説明）を含める。`analysisURL` は解析時の対象URL、`currentPageURL` はコピー時の対象URL。タブ情報から取得するため、DOMとの通信に失敗してもURLを残せる。URLの取得失敗やHTTP(S)以外ではurlをnullにする。

両URLからクエリ・フラグメント・ユーザー名/パスワード・パス内のセッションパラメーターを除く。パスも個人情報を含み得るため、一般的な経路名の許可リストを使用し、それ以外の要素（氏名・メール・数値ID・UUID・任意トークン等）を `[redacted]` にする。許可リストは一般的な静的経路名とその組み合わせだけを対象とし、すべてのサイトの経路を保存するものではない。`pathRedacted` でパスの省略有無が分かる。例：`https://id.auone.jp/id/userinfo/cinfo_set.html?token=...#...` は `https://id.auone.jp/id/userinfo/cinfo_set.html`、`https://example.test/users/alice/address` は `https://example.test/users/[redacted]/address`。ホスト名はサイト特定のため含める。

欄構造はコピー時点、`lastAnalysis` は同じポップアップ内の直近の解析時点。ポップアップを閉じると解析結果は消える。`analysisMatchesPage` は解析時とURL・対象要素の数/順序/同一性が一致する場合のみtrueになる。ラベルや値の変化まで一致を保証しない。入力を適用すると解析スナップショットを破棄するためfalseになる。デバッグ収集によって入力プレビューは破棄しない。

入力済み値・入力予定値・選択中の値・DOM/HTML・ページ本文・タイトル・URLの原文・ラベル・name/id・placeholder・autocomplete・pattern・選択肢の原文・モデル生成文・例外の原文は出力しない。これらにも個人情報が含まれ得るため、欄情報は許可したコード/数値/真偽値だけで新しいオブジェクトを構築し、コピー直前にも再構築する。URLは別途最小化し、説明文は固定の文言から生成する。デバッグ操作はモデル呼び出し・外部送信・履歴保存を行わない。

原文を含めないため、ラベルの解釈違いはこのJSONだけでは完全に再現できない。必要な場合は架空の値と一般的な項目名で最小の合成フォームを作り、回帰テストにする。

## 開発用の生データを保存

認証済みの住所入力画面を実機で開いたまま、ポップアップの「開発用の詳細情報」を展開する。「次の解析で詳細を記録する」をチェックし、「このページを解析」→必要ならプレビューを確認して入力→「開発用データをアプリに保存」。アプリの「保存したデバッグログ」からJSONをファイルに保存・共有する。JSONを調査者に渡すと、認証環境の用意なしでDOMと抽出ロジック、分類の原文、入力前後を照合できる。

これは通常の「デバッグ情報をコピー」と別の出力であり、原文を匿名化しない。個人情報、パスワード欄・hidden欄の値、HTMLやURLに埋め込まれた認証トークンが含まれ得る。共有前に内容を確認する。直近1回の解析記録はページの拡張スクリプト内に保持する。保存ボタンを押すとその記録と現在のDOMを端末内の共有コンテナーへ保存する。ポップアップを閉じても同じ文書で収集でき、チェックなしの再解析・ページの再読み込みでページ内の記録は消える。アプリに保存したJSONは削除するまで残る。URLが変わると旧URLの記録は返さない。

| JSONの位置 | 内容 |
| --- | --- |
| `page.documents` | 保存時のHTML原文、全種類の標準入力欄の属性・現在値・選択肢・選択状態・ラベル原文・表示位置/スタイル・制約の検証結果 |
| `page.lastRun.fields` | 解析時の実際の抽出メタデータと入力前の値。f0等のIDで分類・入力記録と対応 |
| `page.lastRun.analysisPage` | 解析開始時のDOMと現在値のスナップショット |
| `page.lastRun.analysis.response` | ネイティブの返却原文。入力予定値、分類、保留理由、診断を含む |
| `page.lastRun.analysis.response.developerDiagnostics` | ネイティブのOS/locale、経過時間、各バッチのinstructions・prompt・生成JSON・例外原文・出力検証の時系列ログ。詳細記録を指定した要求のみ返す（Releaseでも利用可能） |
| `page.lastRun.fill` | 入力要求、適用直前/直後の値、setter・input/changeイベント・150ms待機後の各時点の値、filled/changed_by_page等の結果、例外、時刻 |
| `page.url`, `page.viewport` | URL全文、user agent、言語、画面サイズ/倍率、スクロール位置 |
| `page.unavailable`, `page.errors`, `page.documents[].truncated` | アクセスできないフレーム、収集時の例外、上限による省略箇所 |

解析前・未記録でも現在のDOMを保存できる。解析未実行・モデル利用不可・タイムアウトは記録に状態を残す。現在ページの取得に失敗した場合は失敗の原文を保存し、成功したスナップショットと区別する。既存のエンドユーザー向け出力は許可したコードだけを再構築し、生データやネイティブtraceを混入させない。

同一オリジンのiframeとopen Shadow DOMも別のdocuments要素として収録する。異なるオリジンのiframe・closed Shadow DOMは取得できない。自動入力の対象範囲はトップ文書の標準欄のまま。最大20文書、合計30,000要素・1,000入力欄・HTML合計2,000,000文字、selectごとの選択肢メタデータは先頭1,000件まで収録し、省略を明示する。解析対象は従来どおり最大40欄。

HTML属性のvalueと実際の現在値は異なる場合があるため、`controls[].value`を参照する。`nodeIndex`はその文書/Shadow DOMの`querySelectorAll('*')`順で、HTML内の欄との対応を取れる。詳細記録に含まれる同じDOM要素には`fieldID`を付け、解析時のf0等へ直接対応できる。サイトが要素を置き換えた場合や未記録の欄はnullになる。HTMLはスクリプトも含む原文であり、信頼したページとして実行せずテキストとして調査する。抽出データから分類の回帰テストを作り、DOMをもとに架空の値の最小フォームへ落とし込む。

Cookie、local/sessionStorage、ネットワーク本文、JavaScriptヒープ・イベントリスナー・収集以前のconsoleログは収録しない。認証後のDOMを調査できるが、サーバー通信やサイトの動的挙動を完全再現するものではない。非同期補完の最終状態は保存時のcontrolsと入力直後のfill.afterを比べる。contentVersionは7。

## 自動検証

Node.js 24以降、Python 3、macOSではSwiftを使用する。

```sh
pnpm test
pnpm check
swiftc Shared/FillPlan.swift Tests/Native/main.swift -o /tmp/fill-planner-tests
/tmp/fill-planner-tests
xcodebuild -project FormFill.xcodeproj -scheme FormFill \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

`Tests/Browser/autofill.cjs` はPlaywrightと対応するWebKitのある環境で `node Tests/Browser/autofill.cjs` として実行する（任意の追加検証）。Playwrightは開発依存として固定し、`pnpm exec playwright install webkit` でブラウザーを準備する。`pnpm test:browser` で既存DOM・ポップアップのテストを実行する。`WEBKIT_EXECUTABLE` で実行ファイルを指定することもできる。WebKitで実際のDOMとポップアップの一連の操作を検証し、ネイティブ分類応答はモックする。Safariの拡張権限・ネイティブ通信・Foundation Models推論は実機で別途確認する。

開発用のネイティブtrace境界は、macOS 26以降の対応Macで次のように追加検証できる。モデルの生成は行わず、空欄リストの要求で通常応答からの除外・明示指定時のtrace返却・JSONシリアライズを確認する。

```sh
swiftc -target "$(uname -m)-apple-macos26.0" Shared/FillPlan.swift \
  SafariExtension/FormClassifier.swift Tests/Native/developer-diagnostics.swift \
  -o /tmp/developer-diagnostics-tests
/tmp/developer-diagnostics-tests
```

2026-10-05の開発用コピーの追加では、Nodeの19テスト・静的チェック、WebKitでの原文/現在値収集・popupの詳細解析→入力→コピー・再注入時の保持・サイト補完の時系列・iframe/Shadow DOM/上限、ネイティブtrace境界、署名なしSimulatorビルドを確認した。iPhone実機で開発用JSONと実モデルのバッチログ取得を確認した。住所欄検出の修正はWebKit・Swiftの回帰テストで検証し、実サイトでの再検証は未実施。

## 検証結果（2026-10-04）

| 検証 | 環境 | 結果 |
| --- | --- | --- |
| `pnpm test` | macOS / Node.js 24.12.0 | 疎通・安全な欄数検出・診断UIテスト成功 |
| `pnpm check` | macOS / Python 3 | plist、manifest、権限、リソース参照成功 |
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

現在の方針では、住所変更などの利用に合わせて都道府県に限らずプレビューの姓名・住所欄を上書きする。上記の実サイト検証は変更前の履歴。プレビュー後の手動変更・サイト補完・制約違反・未分類や対象外の欄の保留は継続する。

## モデル分類のDebugコンソール

XcodeからDebug構成でビルドし、Debug → Attach to Process by PID or NameでSafari拡張のプロセス `FormFillExtension` にアタッチする（未起動の場合は次回起動を待つ）。Safariで拡張を開いて「このページを解析」を押し、コンソールを `[FormFill][FormClassifier]` で絞る。ホストアプリ `FormFill` だけにアタッチしても拡張のログは表示されない。

ログは取得したフォームメタデータの原文、各バッチのinstructions・prompt、生成JSON、例外の詳細、処理時間、検証結果を含む。入力欄の現在値は分類処理へ渡していないため記録しないが、サイトのラベル・入力例・選択肢やモデル出力には機微情報が含まれ得る。これらは `#if DEBUG` の標準出力とOSLog（notice/public）で、Releaseでは出力しない。デバッガ未接続の場合も、macOSのコンソールで接続したiPhoneを選択し、ストリーミングを開始して `FormClassifier` で検索すると受信できる。コピー用JSONとは独立しており、コピー用の匿名化は継続する。

`batch_validation_failed` の `issues` は `count_mismatch`（件数）、`duplicate_ids`（重複）、`unexpected_ids`（要求外ID）、`missing_ids`（欠落）、`invalid_kind`（許可外分類）。直前の `output_raw` と `prompt_raw` を照合して切り分ける。生成自体の失敗は `error_raw` と固定のreasonを出す。

### 住所3欄の出力検証失敗

実機のclassifierVersion 4では、要求IDがf1/f2/f3の3欄に対し `count_mismatch` と `unexpected_ids` が返り、欠落・重複・許可外分類はなかった。placeholder原文は要求に含まれていた。要求外のIDの実値は結果ログを取得できていないため未確認（兄弟文脈にあるf0の混入が候補）。

classifierVersion 5では、動的生成スキーマのID候補を各バッチの要求IDだけにし、配列の最小・最大件数を要求数と一致させた。重複や欠落の事後検証は継続。Macの人工フォームでは3件の出力を確認したが、住所1〜3の意味の分類精度と実機の再検証は別途必要。

コピー収集の `field_metadata` 失敗については、ラベル探索がコメントノードにElementの `matches` を呼ぶ不具合を修正し、コメントを含む欄の回帰テストを追加した。collectorVersionは3、contentVersionは5。対象ページのコピー時エラーがこの原因かは再検証で確認する。

### 住所1〜3への同一住所の重複

classifierVersion 5の実機では、生成形式の検証は成功したが、3欄すべてをaddressWithoutPrefectureと分類した。collectorVersion 3によるページ構造の取得は成功した。

ユーザー指定の既定分割として、classifierVersion 6では説明のない連続した住所1〜3の組にprefectureMunicipality / localityStreet / buildingをルール適用する。ラベル・placeholder・周辺見出しに具体的な説明がある場合、別の住所要素欄がある場合、2欄しかない場合や既に明示ルールで分類されている場合は適用しない。全角番号にも対応。ホスト名やname/idのサイト固有値には依存しない。

モデル分類を使った場合も、番号付き住所欄内で住所要素が重複すると全体を保留し、overlapping_address_componentsを診断に記録する。別の住所1/2の組との重複は検査しない。Fixtures/numbered-address.htmlとSwift/WebKitの回帰テストで、入力済みの4欄の上書き・電話の除外・原文の非送信・分割値を検証する。

### 表形式と例文ラベルの住所欄

郵便番号を `type="tel"` で表す欄も、ラベルまたは近傍見出しから検出する。例文だけのlabelは近傍の項目見出しを優先し、直前の見出し専用trも参照する。titleはplaceholderの補助情報として保持する。`Fixtures/watermark-address.html` は個人情報を含まない再現用フォーム。番地・方書／マンション名の分類と、電話欄・非表示欄の除外、送信を起こさないことを検証する。contentVersion 7、collectorVersion 4、classifierVersion 7。

住所検索がサーバー送信を伴うフォームでは、郵便番号入力後の住所検索と検索結果の選択は利用者が行う。フォーム送信の自動化は行わない。


## TypeScriptのビルドとポップアップ

拡張の正本は `SafariExtension/Source/`。`content/fields.ts` が候補・メタデータ抽出、`snapshot.ts` が変更検知、`apply.ts` が制約確認と入力、`index.ts` がメッセージとページ内状態を扱う。`popup/` は入力プレビュー、疎通診断、匿名化診断コピー、詳細ログ保存に分けた。`diagnostics/` のページ収集関数はSafariの `scripting.executeScript` が単独でシリアライズできるよう、実行時importを持たない。`shared/contracts.ts` がSwiftと対応する型契約。

`pnpm build` でSafari用のclassic IIFEを `Resources/*.js` に生成する。生成JSはGit管理せず、`.gitignore` で除外する。JSを直接編集しない。クリーンチェックアウトでは `pnpm install --frozen-lockfile` と `pnpm build` を実行してから `xcodegen generate` を行う（生成されたリソースをXcodeプロジェクトに含めるため）。TypeScript変更後もbuildを実行する。Web・iOS両方のCIで生成し、strict型チェック、メッセージ境界テスト、実WebKitのポップアップと入力を検証する。

Safariのポップアップを開いて解析するときに、`activeTab` と `scripting.executeScript` でページ内のハンドラーを導入する。フォーカスUI復活後はcontent_scriptsでサイトアクセスを許可されたトップ文書へ自動読み込みする。全サイトのhost_permissionsは宣言しない。通常の解析・診断要求は拡張ページからだけ受け付け、トップ文書のコンテンツスクリプトからはルール専用のanalyzeInlineだけを許可する。

2026-10-06の実機利用フィードバックを受け、フォーカス時の候補UIと専用の解析経路を撤去した。設定画面・TypeScript化・pnpm設定は継続する。下記のインライン確認は撤去前の検証履歴。

撤去後はstrict型チェック、21件のNodeテスト、WebKitでのポップアップ・9欄入力・制約と変更検知の回帰テストが成功。実機向け署名付きDebugビルドとパッケージ検証が成功し、「どらのiPhone 17」への更新インストールを完了した。以前から開いているページでは旧スクリプトが残る場合があるため、更新後にページを再読み込みする。

アプリの設定表示は `DummyProfile` をネイティブの値合成と共有する。保存・プロフィール編集は今回の範囲外。実機でのSafariの権限、キーボード表示、Foundation Modelsの精度は実利用開始時に確認する。


### 2026-10-06の今回の検証

- Xcode 27.0 / iOS 27.0シミュレーターでDebug・Release構成の署名なしビルド成功。使い方タブと設定タブの表示、編集不可のプロフィールのアクセシビリティ内容を確認。
- Node.js 24.12.0 / pnpm 11.19.0でstrict型チェック、21件のメッセージ・診断テスト、plist・manifest・生成リソースの検証に成功。frozen lockfileによる再インストールを確認。
- Playwright 1.56.1 / WebKit 26.0で既存フォームの抽出・9欄入力・上書き・イベント・入力制約・詳細ログの回帰テストに成功。インラインUIの実ポインタークリック、closed Shadow DOM、フォーカス保持、閉じる/Escape、古い計画の拒否、解析中のフォーカス移動、モデル不可・未分類・例外、幅320pxの画面、初期フォーカス、対象欄の削除も確認。分類応答はモック。
- Swiftの住所合成・デバッグログ保存テスト成功。
- 起床後の依頼に従い、接続された「どらのiPhone 17」向けにDebug構成を署名付きでビルド。パッケージ内のmanifest・生成リソースを検証し、実機へインストールしてアプリ起動に成功。実機Safari上の操作確認はまだ行っていない。
- 利用者による127.0.0.1への明示許可後、Fixturesのみをローカル配信し、iOS 27.0シミュレーターのSafariでサイトアクセスを1日だけ許可。`japanese-address.html` のフィールド直下の候補から、実際のcontent→background→native連携を通じて9欄をプレビューし、9欄入力・0欄保留を確認。姓名・カナ・郵便番号・都道府県・市区町村・番地・建物名の表示を確認した。閉じる操作後は別欄へフォーカスしても候補が再表示されないことを確認。
- 上記Safari確認のフォームは明示ラベルを持つ合成フォームであり、曖昧な欄のFoundation Models分類精度を示すものではない。ソフトウェアキーボード表示時の実機レイアウトとストア審査は未確認。

## 複数の住所グループ

フォーム・fieldset・section・role=groupの構造と、autocompleteのsection／shipping／billingを使い、欄に解析内だけで有効な `groupID`（g0など）を付ける。任意のコンテナーIDやsection名はgroupIDに含めない。autocompleteがない欄は同じ構造内の近いスコープへ所属させる。aria-hidden=trueやinert配下の補助欄は対象外。

分類のモデルバッチと兄弟欄の文脈はグループ内に限定する。都道府県・市区町村・建物名など独立した欄がある場合、広い住所分類からその構成を除いて値を合成する。構成を確定できない住所の重複や、姓名・郵便番号の同じ部分を要求する複数欄は保留する。異なるグループには同じダミープロフィールを独立して入力する。グループを指定しない旧要求も受け付ける。

`Fixtures/grouped-addresses.html` は配送先・請求先と補助欄を含む合成フォーム。contentVersionは10、classifierVersionは8。実サイトの推論と入力は実機で別途確認する。

2026-10-06の検証では、Webテスト21件、strict型チェック、scaffoldチェック、Swift値合成・分類バッチ／文脈のグループ分離、ネイティブ診断境界、実WebKitのDOM／ポップアップ回帰テストが成功。iPhone 17 / iOS 27.0向けの署名付きDebugビルド、インストール、ホストアプリ起動も成功した。実機Safariでの解析・入力はユーザー側で検証するため未確認。


## フォーカス時の一行自動入力（2026-10-06）

サイトアクセスを許可されたページへ `content.js` を document_idle で自動読み込みする（トップ文書のみ）。初期の全欄走査、MutationObserver、ポーリング、フォーカス時のネイティブ通信・モデル推論は行わない。フォーカスした一欄のメタデータだけを取得し、明示ラベル・標準autocompleteなど単独でルール判定できる姓名・住所欄に高さ48pxの「自動入力」を表示する。現在値は表示判定では読まない。曖昧な欄は従来のポップアップから解析する。

タップすると同じ構造／autocompleteグループを最大40欄抽出し、`analyzeInline` でSwiftの既存ルール・住所構成・値合成を使用して、そのまま既存の安全なapply処理へ渡す。プレビューやモデル推論は行わず、既存値も上書きする。モデルの準備状況に依存しない。backgroundはトップフレームのHTTP(S)コンテンツスクリプトからこの要求だけを受け付け、現在値・URLをnativeへ転送しない。フォーカス移動・URL／フォーム／値の変更時は古い入力計画を適用しない。

UIはclosed Shadow DOMへ隔離し、ページのレイアウトを押し広げない。ソフトウェアキーボードが出た際のSafariの座標差を避けるためページ座標で直下に配置し、scroll/resizeをrequestAnimationFrameでまとめて追従する。visualViewportの表示領域から下にはみ出す場合は隠す。ボタンへのタップは入力欄のフォーカスを維持する。Escapeで閉じ、別の対象欄へ移れば再表示する。

検証: strict型チェック、21件のNodeテスト、scaffoldチェック、Swiftの値合成・rules-only要求のテスト、WebKitの既存入力回帰とインライン専用テストが成功。インラインでは走査／通信なしの表示判定、一回タップ、グループ限定、フォーカス維持、幅320px・高さ48px、再注入、フォーカス移動・値変更時の取消しを確認。iPhone 17 / iOS 27.0シミュレーターで署名なしDebugビルド・インストールが成功し、Safariの基本フォームでcontent→background→native→applyを通じた9欄入力を確認した。ソフトウェアキーボード表示中の直下表示とタップ操作も確認。実機は使用していない。
