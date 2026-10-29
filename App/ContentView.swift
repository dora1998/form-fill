import FormFillCore
import FormFillApplication
import SwiftUI

struct ContentView: View {
    private enum AppTab: Hashable { case welcome, settings }
    @State private var selectedTab: AppTab = .welcome
    let dependencies: AppDependencies
    var body: some View {
        TabView(selection: $selectedTab) {
            Tab("使い方", systemImage: "sparkles.rectangle.stack", value: AppTab.welcome) {
                NavigationStack { WelcomeView() }
            }
            Tab("設定", systemImage: "gearshape", value: AppTab.settings) {
                NavigationStack { ProfileSettingsView(client: dependencies.profiles, reports: dependencies.reports) }
            }
        }
        .tint(.blue)
        .onOpenURL { url in
            guard url.scheme == "formfill", url.host == "settings",
                  url.path.isEmpty || url.path == "/" else { return }
            selectedTab = .settings
        }
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
                    step("1", title: "プロフィールを登録", detail: "このアプリの設定で認証し、姓名・住所を登録します。端末パスコードの設定が必要です。")
                    step("2", title: "Safari拡張をオンにする", detail: "設定 → アプリ → Safari → 機能拡張 → Form Fillをオンにし、利用するサイトへのアクセスを許可します。")
                    step("3", title: "解析・認証・確認して入力", detail: "HTTPSの入力ページでSafariのForm Fillを開き、解析してから登録情報を確認します。入力先と予定値を確認して入力してください。既存値は上書きされます。")
                }
                .padding(20)
                .background(.background, in: RoundedRectangle(cornerRadius: 20))

                VStack(alignment: .leading, spacing: 10) {
                    Label("姓名・住所を安全に保存", systemImage: "person.crop.rectangle")
                        .font(.headline)
                    Text("端末内の保護された領域に保存し、利用時に認証します。機種変更時は再登録が必要です。入力した瞬間からサイトは値を読み取れます。")
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

#Preview { ContentView(dependencies: .preview) }
