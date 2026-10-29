# 開発と検証

現行の責務・依存方向は[アーキテクチャ](architecture.md)を参照してください。Swiftのソース一覧はローカルPackage、App/Extensionの設定は `project.yml`、拡張のbundle入口は `scripts/build-extension.mjs` が正本です。

## ローカル検証の入口

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm check
pnpm test:browser
pnpm test:native
xcodegen generate
xcodebuild -project FormFill.xcodeproj -scheme FormFill \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build CODE_SIGNING_ALLOWED=NO build
python3 scripts/check-scaffold.py build/Build/Products/Debug-iphonesimulator/FormFill.app/PlugIns/FormFillExtension.appex
```

`pnpm test:native` は `swift test --package-path Packages/FormFillKit` です。分類・値合成、入力セッション、通信契約、プロフィール編集、診断保存の回帰テストを実モデル・実認証なしで実行します。通常の診断が値を読み出さないこと、取消や期限切れのあとに値を返さないことも維持します。

`pnpm test:browser` はPlaywrightのWebKitを使います。未取得の場合は `pnpm exec playwright install webkit` を実行してください。これはSafari拡張プロセスそのものの実機検証ではありません。

実モデルの精度評価は別のコマンドで明示的に実行します。

```sh
pnpm test:model
```

モデル評価はApple Intelligenceの利用可能な環境が必要です。通常のCIの単体テストに実モデルの応答や速度を合否条件として含めません。共有Keychain・Face ID/端末パスコード・App Group保護属性は引き続き実機で確認します。

## 過去の実装・検証記録

リファクタリング以前の実装・実機評価は[開発履歴](development-history.md)に保存しています。旧ファイル名やダミープロフィール、廃止した `analyzeInline` の記述は当時の記録です。現行の手順はこのページを参照してください。
