# Form Fill

日本の姓名・住所を入力欄に合わせて自動入力する、iOSアプリ＋Safari Web Extensionの開発リポジトリです。フォームの意味をオンデバイスLLMで分類し、登録情報をローカルで組み立てる設計を検討しています。

アプリの設定で姓名・カナ・住所を1件登録し、SafariのForm Fillから解析・認証・プレビュー確認・入力できます。登録情報はアプリとネイティブ拡張専用のKeychainへ保存し、Face ID／Touch IDまたは端末パスコードによる読み出しを要求します。独自パスコードやクラウド同期はありません。機種変更・端末パスコードの除去／リセット後は再登録が必要です。

モデルにはフォームのメタデータだけを送り、プロフィールを渡しません。実値は認証後にコードで合成します。入力先はHTTPSのトップレベルページに限定します。ページ内の「自動入力」からは解析後に入力先を示して一回認証し、そのまま入力します。Safariの拡張メニューから開いた場合は、プレビュー確認と入力時にそれぞれ認証します。入力した瞬間からサイトは値を読み取れます。既存値は上書きしますが、フォームは自動送信しません。

保存と認証のコード・ローカル回帰テストは実装済みです。**署名した実機での共有Keychain、SafariからのFace ID／端末パスコード認証、端末ロック・機種変更時の動作確認は未完了です。** 配布前の確認項目は[保存・認証設計](docs/profile-security-design.md)に記載しています。

## 仕様

- [プロダクト仕様・未決事項](docs/product-spec.md)
- [アーキテクチャ・実機検証計画](docs/architecture.md)
- [実プロフィールの保存・認証設計案](docs/profile-security-design.md)
- [開発と検証の手順](docs/development.md)

初期版はiOS 26以降・Apple Intelligence対応端末を対象とし、非対応端末向けの提供は対象外です。プロフィールは1件から始め、内部設計はIDによる参照と複数件を扱える保管形式にします。Apple Intelligenceの有効化・モデルの準備状態と、Safari拡張内でのモデル実行は別途確認が必要です。

## macOSで開く

Xcode 26以降と[XcodeGen](https://github.com/yonaskolb/XcodeGen)を用意してください。

```sh
brew install xcodegen
pnpm install --frozen-lockfile
pnpm build
xcodegen generate
open FormFill.xcodeproj
```

生成JavaScript（`SafariExtension/Resources/*.js`）はGit管理しません。初回は上記の順序で生成してからXcodeプロジェクトを作り、TypeScript変更後は `pnpm build` を実行してください。

`project.yml` が構成の正本です。生成した `.xcodeproj` はコミットせず、構成変更は `project.yml` に反映します。Info.plistは生成結果も追跡し、再生成で差分が出ないよう、設定と生成結果を一緒に更新します。

`FormFill` schemeを選び、両ターゲットのSigning & Capabilitiesで自分のTeamを指定してください。実機用Bundle IDは `project.yml` のアプリ・拡張を同じ接頭辞で固有のものへ変更します。拡張のIDを変更した場合は `SafariExtension/Source/background.ts` のnative message送信先と関連テストも合わせて変更します。

```sh
xcodebuild -project FormFill.xcodeproj -scheme FormFill \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

実機へアプリをインストールし、Safariの機能拡張でForm Fillを有効化してください。利用するサイトへのアクセスをSafariで許可します。フォームのあるページで拡張を開き「このページを解析」→「認証して登録情報を確認する」→プレビュー確認→「認証して入力する」を選びます。Apple Intelligenceが未準備・利用不能の場合は理由を表示します。疎通・モデル診断ボタンも残しています。

認識がうまくいかないページでは、解析後に「デバッグ情報をコピー」を押すと、対象URL・診断の要約・欄の構造・直近の分類と保留理由・コードの説明をJSONでコピーできます。URLはクエリ・フラグメント・認証情報を除き、一般的な経路名以外のパス要素を伏せます。入力値、ラベル・選択肢の原文、ページ本文は含めません。自動コピーできない環境では手動コピー用の欄を表示します。詳細は[開発手順](docs/development.md)を参照してください。

開発者向けの詳細ログも利用できます。「診断・開発用ツール」で「詳細収録」をオンにしてから解析・入力を行い、「認証して詳細ログをアプリに保存」を押してください。現在と解析時のDOM、欄の属性・実値・表示状態、モデルの指示・応答・エラー、入力前後とイベントごとの値を残します。詳細収録は既定でオフで、通常の診断には混ぜません。

保存時にOS認証を行い、現在登録している姓名・住所と一般的な連結・カナ・全半角・エンコード表記の一致箇所をネイティブ側でマスキングしてから、端末のApp Groupへ保存します（完全ファイル保護・バックアップ除外）。認証失敗時は保存しません。これは登録プロフィールだけのベストエフォートなマスキングであり、他人の情報、以前のプロフィール、未知の表記、DOM内の認証情報などは残る場合があります。設定の「保存したデバッグログ」から共有・保存・削除できます。

Cookie・ブラウザーストレージ・通信内容は取得しません。別originのiframeやclosed shadow、収録上限を超えた部分は取得できず、その制約をログに記録します。解析前に詳細収録をオンにし忘れた場合も現在のDOMは保存できますが、過去の解析・入力過程は復元できません。

プロフィールの共有には、両ターゲットの `keychain-access-groups` とInfo.plistの `ProfileKeychainAccessGroup` に同じ `$(AppIdentifierPrefix)dev.formfill.profiles` を設定します。設定の正本は `project.yml` です。実機署名時は両ターゲットでKeychain Sharingを利用できるプロビジョニングを用意してください。App Groupは認証・プロフィールマスキング後の詳細ログ保存に使用します。

### Safari拡張内からのローカルモデル診断

Safariの拡張ポップアップで「拡張からローカルモデルを確認」を選ぶと、ネイティブ拡張が `SystemLanguageModel.default.availability` を確認し、利用可能な場合はFoundation Modelsへ固定の診断文を送り、結果を返します。プロンプト、フォーム情報、ページ内容は拡張から送信せず、結果も短く制限します。これは拡張プロセスからAPIを呼べるかの診断で、分類や自動入力の機能ではありません。

シミュレーターではアプリと拡張のビルド・起動を確認できますが、Apple Intelligenceのモデルが使えるとは限りません。実際の生成成功はApple Intelligenceとモデルの準備が整った対応iPhone上で確認してください。ポップアップには利用不可の理由、生成成功、生成失敗を表示します。

## ローカル検証

Node.js 24以降、pnpm 11.19.0、Python 3を使用します。依存関係は `pnpm install --frozen-lockfile` で取得します。`pnpm-workspace.yaml` の `minimumReleaseAge: 4320` で公開後3日未満の依存バージョンを除外します。

```sh
pnpm test
pnpm check
```

JavaScriptテストはブラウザーAPIとDOMのモックを使って、native message、安全な入力欄カウント、ポップアップの成功・失敗を検証します。Swiftの値合成テストと実DOMのWebKitテストは[開発手順](docs/development.md)を参照してください。静的チェックはplistとmanifestの整合性、権限、リソース参照を検証します。これらはiOSビルド・Safari実機動作・LLM精度の検証を代替しません。

`.github/workflows/validate.yml` にmacOSでのプロジェクト生成・署名なしビルドとローカル検証を定義しています。PRのmacOS CIに加え、iPhone 17でSafari拡張のネイティブ連携とFoundation Modelsの固定文生成も確認済みです。詳しい条件は[開発と検証の手順](docs/development.md)を参照してください。

## 構成

```text
App/                        SwiftUIアプリ
SafariExtension/            ネイティブハンドラーと拡張リソース
Shared/                     メッセージ検証・プロフィール・Keychain保存・値合成
Fixtures/                   実機確認用の合成フォーム
SafariExtension/Source/     拡張のTypeScriptソース（責務別モジュール）
Tests/Web/                  拡張のTypeScript成果物テスト
docs/                       仕様、設計、開発手順
project.yml                 XcodeGenプロジェクト定義
```


### 入力時の保護

HTTPSの姓名・住所欄にフォーカスすると、欄の直下に高さ48pxの「自動入力」ボタンを表示します。タップすると拡張ポップアップ内で解析を開始し、Face ID／Touch IDまたは端末パスコードで一回認証した後、自動で入力してフォームへ戻ります。追加の解析・確認・入力ボタン操作は不要です。フォーカス時の全欄走査やネイティブ通信は行いません。認証前に拡張画面へ入力先と既存値の上書きを表示し、キャンセルできます。Safariの拡張メニューから開けば、従来のプレビュー付き入力も利用できます。入力計画はタブ・origin・文書のスナップショット・プロフィールrevisionに結び付け、一回だけ使用できます。プレビューの期限は60秒です。遷移、欄の変更、プロフィールの編集・削除、認証キャンセル、拡張プロセス再起動時は再解析が必要です。
