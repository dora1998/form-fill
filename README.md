# Form Fill

日本の姓名・住所を入力欄に合わせて自動入力する、iOSアプリ＋Safari Web Extensionの開発リポジトリです。フォームの意味をオンデバイスLLMで分類し、登録情報をローカルで組み立てる設計を検討しています。

現在は **SwiftUIアプリ、Safari拡張、ネイティブ疎通確認の土台** です。プロフィール保存・自動入力・LLM推論は未実装です。

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

`project.yml` が構成の正本です。生成した `.xcodeproj` はコミットせず、構成変更は `project.yml` に反映します。

`FormFill` schemeを選び、両ターゲットのSigning & Capabilitiesで自分のTeamを指定してください。実機用Bundle IDは `project.yml` のアプリ・拡張を同じ接頭辞で固有のものへ変更します。拡張のIDを変更した場合は `background.js` のnative message送信先と関連テストも合わせて変更します。

```sh
xcodebuild -project FormFill.xcodeproj -scheme FormFill \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO build
```

実機へアプリをインストールし、Safariの機能拡張でForm Fillを有効化してください。フォームのあるページで拡張を開き「このページで疎通を確認」を選ぶと、ネイティブ連携の結果と入力欄の個数を表示します。

## ローカル検証

Node.js 22.8以降、Python 3を使用します。npmパッケージのインストールは不要です。

```sh
npm test
npm run check
```

JavaScriptテストはブラウザーAPIとDOMのモックを使って、固定のnative message、安全な入力欄カウント、ポップアップの成功・失敗を検証します。静的チェックはplistとmanifestの整合性、権限、リソース参照を検証します。これらはiOSビルド・Safari実機動作・LLM精度の検証を代替しません。

`.github/workflows/validate.yml` にmacOSでのプロジェクト生成・署名なしビルドとローカル検証を定義しています。この開発環境はLinuxのため、Xcodeビルドと実機動作は未実行です。

## 構成

```text
App/                        SwiftUIアプリ
SafariExtension/            ネイティブハンドラーと拡張リソース
Shared/                     native messageの疎通契約
Fixtures/                   実機確認用の合成フォーム
Tests/Web/                  拡張のJavaScriptテスト
docs/                       仕様、設計、開発手順
project.yml                 XcodeGenプロジェクト定義
```
