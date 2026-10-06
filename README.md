# Form Fill

日本の姓名・住所を入力欄に合わせて自動入力する、iOSアプリ＋Safari Web Extensionの開発リポジトリです。フォームの意味をオンデバイスLLMで分類し、登録情報をローカルで組み立てる設計を検討しています。

アプリの設定で姓名・カナ・住所を1件登録し、SafariのForm Fillから解析・認証・プレビュー確認・入力できます。登録情報はアプリとネイティブ拡張専用のKeychainへ保存し、Face ID／Touch IDまたは端末パスコードによる読み出しを要求します。独自パスコードやクラウド同期はありません。機種変更・端末パスコードの除去／リセット後は再登録が必要です。

モデルにはフォームのメタデータだけを送り、プロフィールを渡しません。実値は認証後にコードで合成します。入力先はHTTPSのトップレベルページに限定し、入力前の確認を必須にしています。プレビューと入力時はそれぞれ認証を確認します。入力した瞬間からサイトは値を読み取れます。既存値は上書きしますが、フォームは自動送信しません。

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

実プロフィールへの移行に伴い、DOM全文・入力値・モデル入出力を収録する詳細診断は無効にしました。収録用JavaScriptは配布リソースから除外し、ネイティブ保存要求も拒否します。旧バージョンの詳細ログは設定画面で認証後、「保存したデバッグログ」から削除できます。

プロフィールの共有には、両ターゲットの `keychain-access-groups` とInfo.plistの `ProfileKeychainAccessGroup` に同じ `$(AppIdentifierPrefix)dev.formfill.profiles` を設定します。設定の正本は `project.yml` です。実機署名時は両ターゲットでKeychain Sharingを利用できるプロビジョニングを用意してください。既存のApp Groupは旧ログ管理に使用します。

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

ページ内の一行自動入力は無効にし、実住所の入力は拡張ポップアップから行います。入力計画はタブ・origin・文書のスナップショット・プロフィールrevisionに結び付け、一回だけ使用できます。プレビューの期限は60秒です。遷移、欄の変更、プロフィールの編集・削除、認証キャンセル、拡張プロセス再起動時は再解析が必要です。
