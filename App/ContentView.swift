import SwiftUI

struct ContentView: View {
    var body: some View {
        TabView {
            Tab("使い方", systemImage: "sparkles.rectangle.stack") {
                NavigationStack { WelcomeView() }
            }
            Tab("設定", systemImage: "gearshape") {
                NavigationStack { ProfileSettingsView() }
            }
        }
        .tint(.blue)
    }
}

private struct WelcomeView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                VStack(alignment: .leading, spacing: 14) {
                    Image(systemName: "rectangle.and.pencil.and.ellipsis")
                        .font(.system(size: 38)).foregroundStyle(.blue)
                        .accessibilityHidden(true)
                    Text("住所入力を、\nもっとスムーズに。")
                        .font(.largeTitle.bold())
                    Text("Safariの姓名・住所欄に合わせて、入力候補をまとめて提案します。")
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(24)
                .background(.blue.opacity(0.08), in: RoundedRectangle(cornerRadius: 24))

                VStack(alignment: .leading, spacing: 20) {
                    Text("はじめるための3ステップ").font(.title3.bold())
                    step("1", title: "Safari拡張をオンにする", detail: "設定 → アプリ → Safari → 機能拡張 → Form Fillをオンにします。")
                    step("2", title: "サイトへのアクセスを許可", detail: "SafariのページメニューからForm Fillを選び、利用するサイトへのアクセスを許可します。")
                    step("3", title: "入力欄から自動入力", detail: "姓名・住所の入力欄を選び、直下の「自動入力」を押します。同じグループの判定できる欄へ、お試しプロフィールを入力します。既存値も上書きします。候補を確認したいときはSafariのページメニューからForm Fillを開けます。")
                }
                .padding(20)
                .background(.background, in: RoundedRectangle(cornerRadius: 20))

                VStack(alignment: .leading, spacing: 10) {
                    Label("現在はお試しプロフィール", systemImage: "person.crop.rectangle")
                        .font(.headline)
                    Text("山田 太郎さんの架空の情報でお試しいただけます。設定画面で入力する内容を確認できます。住所の編集・保存は今後対応予定です。")
                }
                .font(.subheadline)

                Label("解析は端末内で処理。フォームは自動送信しません。", systemImage: "lock.shield")
                    .font(.footnote).foregroundStyle(.secondary)
                Text("iOS 26以降・Apple Intelligence対応端末が必要です。Apple Intelligenceを有効にし、モデルの準備が完了してからご利用ください。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            .padding(20)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Form Fill")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func step(_ number: String, title: String, detail: String) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Text(number).font(.headline).foregroundStyle(.blue)
                .frame(width: 30, height: 30)
                .background(.blue.opacity(0.1), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 5) {
                Text(title).font(.headline)
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
    }
}

#Preview { ContentView() }
