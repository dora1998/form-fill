# Form Fill

日本の姓名・住所を入力欄に合わせて自動入力する、iOSアプリ＋Safari Web Extensionの開発リポジトリです。フォームの意味をオンデバイスLLMで分類し、登録情報をローカルで組み立てる設計を検討しています。

現在は **固定のダミープロフィールによる自動入力プロトタイプ** です。Safariで入力欄を抽出し、明確な欄はルール、曖昧な欄はFoundation Modelsで分類します。入力予定値を確認してから入力できます。プロフィール保存は未実装で、実機での分類精度はこれから検証します。

ダミー値: 山田 太郎 / ヤマダ タロウ / 100-0001 / 東京都千代田区千代田1-1 / テストマンション101号室。モデルにはフォームのメタデータだけを送り、姓名・住所の値はコードで合成します。プレビューに表示した姓名・住所欄は既存の入力値も上書きします。自動送信は行いません。

## 仕様

- [プロダクト仕様・未決事項](docs/product-spec.md)
- [アーキテクチャ・実機検証計画](docs/architecture.md)
- [開発と検証の手順](docs/development.md)

初期版はiOS 26以降・Apple Intelligence対応端末を対象とし、非対応端末向けの提供は対象外です。プロフィールは1件から始め、内部設計はIDによる参照と複数件を扱える保管形式にします。Apple Intelligenceの有効化・モデルの準備状態と、Safari拡張内でのモデル実行は別途確認が必要です。

## macOSで開く

Xcode 26以降と[XcodeGen](https://github.com/yonaskolb/XcodeGen)を用意してください。

```sh
brew install xcodegen
xcodegen generate
open FormFill.xcodeproj
```

`project.yml` が構成の正本です。生成した `.xcodeproj` はコミットせず、構成変更は `project.yml` に反映します。Info.plistは生成結果も追跡し、再生成で差分が出ないよう、設定と生成結果を一緒に更新します。

`FormFill` schemeを選び、両ターゲットのSigning & Capabilitiesで自分のTeamを指定してください。実機用Bundle IDは `project.yml` のアプリ・拡張を同じ接頭辞で固有のものへ変更します。拡張のIDを変更した場合は `background.js` のnative message送信先と関連テストも合わせて変更します。

```sh
xcodebuild -project FormFill.xcodeproj -scheme FormFill \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

実機へアプリをインストールし、Safariの機能拡張でForm Fillを有効化してください。フォームのあるページで拡張を開き「このページを解析」→プレビュー確認→「ダミー情報を入力する」を選びます。Apple Intelligenceが未準備・利用不能の場合は理由を表示します。疎通・モデル診断ボタンも残しています。

認識がうまくいかないページでは、解析後に「デバッグ情報をコピー」を押すと、対象URL・診断の要約・欄の構造・直近の分類と保留理由・コードの説明をJSONでコピーできます。URLはクエリ・フラグメント・認証情報を除き、一般的な経路名以外のパス要素を伏せます。入力値、ラベル・選択肢の原文、ページ本文は含めません。自動コピーできない環境では手動コピー用の欄を表示します。詳細は[開発手順](docs/development.md)を参照してください。

### Safari拡張内からのローカルモデル診断

Safariの拡張ポップアップで「拡張からローカルモデルを確認」を選ぶと、ネイティブ拡張が `SystemLanguageModel.default.availability` を確認し、利用可能な場合はFoundation Modelsへ固定の診断文を送り、結果を返します。プロンプト、フォーム情報、ページ内容は拡張から送信せず、結果も短く制限します。これは拡張プロセスからAPIを呼べるかの診断で、分類や自動入力の機能ではありません。

シミュレーターではアプリと拡張のビルド・起動を確認できますが、Apple Intelligenceのモデルが使えるとは限りません。実際の生成成功はApple Intelligenceとモデルの準備が整った対応iPhone上で確認してください。ポップアップには利用不可の理由、生成成功、生成失敗を表示します。

## ローカル検証

Node.js 24以降、Python 3を使用します。npmパッケージのインストールは不要です。

```sh
npm test
npm run check
```

JavaScriptテストはブラウザーAPIとDOMのモックを使って、native message、安全な入力欄カウント、ポップアップの成功・失敗を検証します。Swiftの値合成テストと実DOMのWebKitテストは[開発手順](docs/development.md)を参照してください。静的チェックはplistとmanifestの整合性、権限、リソース参照を検証します。これらはiOSビルド・Safari実機動作・LLM精度の検証を代替しません。

`.github/workflows/validate.yml` にmacOSでのプロジェクト生成・署名なしビルドとローカル検証を定義しています。PRのmacOS CIに加え、iPhone 17でSafari拡張のネイティブ連携とFoundation Modelsの固定文生成も確認済みです。詳しい条件は[開発と検証の手順](docs/development.md)を参照してください。

## 構成

```text
App/                        SwiftUIアプリ
SafariExtension/            ネイティブハンドラーと拡張リソース
Shared/                     メッセージ検証・固定プロフィール・値合成
Fixtures/                   実機確認用の合成フォーム
Tests/Web/                  拡張のJavaScriptテスト
docs/                       仕様、設計、開発手順
project.yml                 XcodeGenプロジェクト定義
```
