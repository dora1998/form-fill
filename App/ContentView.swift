import SwiftUI

struct ContentView: View {
    var body: some View {
        NavigationStack {
            List {
                Section {
                    Label("姓名・住所を、入力欄に合わせて。", systemImage: "rectangle.and.pencil.and.ellipsis")
                    Text("Form Fillは、日本の姓名・住所の自動入力を目指す開発中のアプリです。")
                }
                Section("Safari拡張を有効にする") {
                    Text("設定 → アプリ → Safari → 機能拡張 → Form Fillをオンにしてください。")
                    Text("Safariでフォームを開き、拡張のメニューからForm Fillを選ぶと「このページを解析」からダミー情報の入力を試せます。")
                }
                Section("現在の開発段階") {
                    Label("固定ダミー情報による自動入力", systemImage: "checkmark.circle")
                    Text("固定の架空プロフィールを使い、ルールと端末内モデルで姓名・住所を分類して入力します。プロフィール保存は未実装です。")
                    Text("山田 太郎 / 100-0001 東京都千代田区千代田1-1 テストマンション101号室。入力先サイトへダミー値が渡ります。")
                }
            }
            .navigationTitle("Form Fill")
        }
    }
}
