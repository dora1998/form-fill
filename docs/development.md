# 開発・検証の手順

## 土台で実装した範囲

SwiftUIアプリは拡張有効化の案内と開発状態を表示する。拡張のポップアップからバックグラウンドを経由し、`SafariWebExtensionHandler`へ `{"version":1,"type":"health"}` を送り、利用可能な機能を返す。現在の機能はネイティブ疎通だけで、プロフィール保存・ローカルモデル・自動入力はすべて `false` である。

その後、利用者の操作によって現在のタブへcontent scriptを挿入し、表示中・編集可能な入力欄の個数だけを返す。値、ラベル、URL、ページ全文はネイティブへ送らず、DOM変更も行わない。パスワード、非表示、無効、読み取り専用等の欄は対象外。トップレベル文書のみを数える。

manifestには `activeTab`、`scripting`、`nativeMessaging` のみを指定している。常時動作するcontent scriptや全サイトのhost permissionは追加していない。App Group、Keychain共有、Foundation Modelsへの依存も今後の検証に合わせて追加する。

## macOSのビルド

READMEの手順でXcodeGenプロジェクトを生成する。`FormFill` アプリは `FormFillExtension.appex` を埋め込み、拡張はSafariServicesをリンクする。manifestとJavaScriptなどは拡張のbundle resourceとして配置する。

署名なしのSimulatorビルドが通った後、実機で両ターゲットのTeamとBundle IDを設定する。Safari拡張はホストアプリから有効状態を自動設定できないため、利用者がSafariの設定から有効化する。

アプリ・拡張のdeployment targetはiOS 26.0、開発にはXcode 26以降を使用する。初期版の対象はApple Intelligence対応端末とする。OSバージョンだけで対応端末を判別できないため、モデル実装時にAPIで利用状態を確認する。現在の疎通コードにはモデルの利用可否判定は未実装である。

## 実機での疎通チェック

1. アプリを起動し、開発状態と拡張の設定案内が表示されることを確認する。
2. 設定 → アプリ → Safari → 機能拡張 → Form Fillを有効化する（OSによって設定の導線は異なる）。
3. 同じネットワークのMac等で `python3 -m http.server 8000 --bind 0.0.0.0` をリポジトリのルートから起動する。実プロフィールは使わない。
4. iPhoneのSafariで `http://<MacのLANアドレス>:8000/Fixtures/japanese-address.html` を開く。
5. 拡張メニューからForm Fillを開き、必要なサイトアクセスを許可して「このページで疎通を確認」を押す。
6. 「ネイティブ連携OK」と「入力欄は9個」が表示されることを確認する。
7. 繰り返し実行して同じ結果になり、値が変更されないことを確認する。
8. 新しいタブやSafariの保護されたページで失敗メッセージが表示され、再試行できることを確認する。

## Foundation Models 拡張プロセス診断

1. Apple Intelligence対応のiPhoneでApple Intelligenceを有効にし、オンデバイスモデルの準備完了を待つ。
2. Form Fillをインストールし、Safariで拡張を有効にする。
3. Safariの拡張ポップアップから「拡張からローカルモデルを確認」を押す。
4. 「拡張プロセスから生成成功: FORM_FILL_LOCAL_MODEL_OK」が出れば、Safari Web ExtensionのネイティブプロセスでFoundation Modelsの生成が完了した。
5. 利用不可や生成失敗の場合は、画面に表示された理由を記録する。シミュレーターで利用不可が出ても、対応する実機での生成可能性は判断しない。

診断要求は固定型で、任意のプロンプト、ページの内容、入力値を渡さない。応答も短く上限を設け、モデルの出力をアプリ機能に利用しない。この確認では速度、メモリ、Safariによるプロセス終了、オフライン時の挙動を測定しない。

実機結果は未記入。OS、端末、Xcodeバージョン、成功・失敗、発生手順を実機確認後に記録する。

## 今回の検証結果（2026-10-04）

| 検証 | 環境 | 結果 |
| --- | --- | --- |
| `npm test` | Linux / Node.js 24.19.0 | 4件成功（ブラウザー・DOMはモック） |
| `npm run check` | Linux / Python 3 | plist、manifest、権限、リソース参照の静的チェック成功 |
| `project.yml` 読込 | Linux / PyYAML | YAMLとして読込成功、アプリ・拡張の2ターゲットを確認 |
| XcodeGen生成・iOSビルド | GitHub Actions / macOS / Xcode 26.0 | 初回PRのCIで署名なしSimulatorビルド成功 |
| Safari疎通・LLM利用 | iPhoneが必要 | 未実行 |

初回CIのwebジョブは、Node.js 22が `--test-isolation=none` に対応せず起動時に失敗した。テスト起動オプションを維持し、CI・package.json・開発手順を検証済みのNode.js 24以降へ統一した。

## 次に行う実験

まずネイティブハンドラーでFoundation Modelsの利用可否確認と短い構造化推論を実行する実験を追加し、アプリを開かずにSafariから完了するか測る。実行時間、メモリ、タイムアウト、オフライン、モデル利用不能時を検証する。これが成立するまで、拡張からモデルを呼べると仕様で断定しない。

同時に合成プロフィールを使って標準selectの都道府県選択、番地専用欄、姓名分割の入力計画を純粋ロジックで検証する。実プロフィール保存の実装は共有・保護方式を決めてから進める。
