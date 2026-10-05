import SwiftUI

struct ProfileSettingsView: View {
    // Use the same source as native value composition so this preview cannot drift.
    private let profile = DummyProfile()

    var body: some View {
        Form {
            Section {
                Label("お試しプロフィール", systemImage: "person.crop.circle.fill")
                    .font(.headline).foregroundStyle(.blue)
                Text("現在は架空の姓名・住所を使用します。編集・保存は今後対応予定です。")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Section("姓名") {
                field("姓", value: profile.family)
                field("名", value: profile.given)
                field("セイ", value: profile.familyKana)
                field("メイ", value: profile.givenKana)
            }
            Section("住所") {
                field("郵便番号", value: "\(profile.postal.prefix(3))-\(profile.postal.suffix(4))")
                field("都道府県", value: profile.prefecture)
                field("市区町村", value: profile.municipality)
                field("町名・町域", value: profile.locality)
                field("丁目・番地・号", value: profile.street)
                field("建物名・部屋番号", value: profile.building)
            }
            Section("入力される住所") {
                Text(profile.value(for: .fullAddress) ?? "")
                    .textSelection(.enabled)
                Text("入力欄の構成に合わせて、この住所を分割して入力します。入力先サイトに値が渡り、候補に表示された欄の既存値は上書きされます。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("プライバシー") {
                Label("姓名・住所はモデルへ送りません", systemImage: "lock.shield")
                Text("フォームの項目情報を端末内で解析し、プロフィールから入力値を組み立てます。外部のAIサービスには送信しません。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Section("詳細") {
                NavigationLink { DebugReportsView() } label: {
                    Label("保存したデバッグログ", systemImage: "doc.text.magnifyingglass")
                }
                LabeledContent("バージョン", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.1.0")
            }
        }
        .navigationTitle("設定")
    }

    private func field(_ title: String, value: String) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField(title, text: .constant(value))
                .disabled(true)
                .foregroundStyle(.primary)
        }
        .padding(.vertical, 3)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityValue(value + "、編集は今後対応予定")
    }
}

#Preview { NavigationStack { ProfileSettingsView() } }
