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
                    Text("Safariでフォームを開き、拡張のメニューからForm Fillを選ぶと疎通を確認できます。")
                }
                Section("現在の開発段階") {
                    Label("アプリと拡張の疎通確認", systemImage: "checkmark.circle")
                    Text("プロフィール保存、自動入力、ローカルLLMはまだ実装されていません。")
                    Text("この土台では個人情報を保存せず、外部サーバーへの送信も行いません。")
                }
            }
            .navigationTitle("Form Fill")
        }
    }
}
