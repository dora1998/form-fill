import FormFillCore
import FormFillApplication
import SwiftUI

struct ProfileSettingsView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var model: ProfileEditorModel
    private let reports: ReportRepository
    @State private var confirmDelete = false
    @State private var showLegacyLogs = false

    init(client: ProfileEditingClient, reports: ReportRepository) {
        _model = State(initialValue: ProfileEditorModel(client: client))
        self.reports = reports
    }

    var body: some View {
        @Bindable var model = model
        Form {
            Section {
                Label("端末内のプロフィール", systemImage: "lock.shield")
                    .font(.headline)
                Text("姓名・住所はこの端末にのみ保存します。機種変更や端末パスコードの解除・リセット後は再登録が必要です。")
                Text("Face IDまたは端末パスコードで保護します。端末パスコードを知る人も解除できます。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if model.unlocked {
                Section("姓名") {
                    TextField("姓", text: $model.draft.family)
                    TextField("名", text: $model.draft.given)
                    TextField("セイ", text: $model.draft.familyKana)
                    TextField("メイ", text: $model.draft.givenKana)
                }
                Section("住所") {
                    TextField("郵便番号（半角7桁）", text: $model.draft.postal).keyboardType(.numberPad)
                    Picker("都道府県", selection: $model.draft.prefecture) {
                        ForEach(Profile.prefectures, id: \.self) { Text($0).tag($0) }
                    }
                    TextField("市区町村", text: $model.draft.municipality)
                    TextField("町名・町域", text: $model.draft.locality)
                    TextField("丁目・番地・号", text: $model.draft.street)
                    TextField("建物名・部屋番号（任意）", text: $model.draft.building)
                }
                .autocorrectionDisabled()
                Section {
                    Button("認証して保存する") { model.save() }.disabled(model.busy)
                    Button("保存せずにロック") { model.lock() }.disabled(model.busy)
                }
                Section("開発用の詳細ログ") {
                    Text("Safariから詳細ログを保存できます。登録プロフィールは保存時にマスキングしますが、他の入力値やページ内の情報は残ります。共有前に確認してください。")
                    Button("保存したデバッグログ") { showLegacyLogs = true }
                }
            } else {
                Section {
                    Button("認証して登録・編集する") { model.open() }.disabled(model.busy)
                    Text("登録した姓名・住所はモデルに渡しません。SafariのForm Fillから解析・認証・確認して入力できます。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            if !model.status.isEmpty { Section { Text(model.status).font(.footnote).accessibilityAddTraits(.updatesFrequently) } }
            if model.busy { ProgressView("処理中…") }
            Section {
                Button("保存したプロフィールを削除", role: .destructive) { confirmDelete = true }.disabled(model.busy)
                Text("削除には認証が必要です。入力先サイトに渡した情報や、以前の詳細ログは別途削除してください。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .disabled(scenePhase == .background)
        .overlay {
            if scenePhase != .active {
                Color(.systemGroupedBackground).ignoresSafeArea()
                    .overlay { Label("プロフィールは保護されています", systemImage: "lock.fill") }
            }
        }
        .navigationTitle("プロフィール設定")
        .navigationDestination(isPresented: $showLegacyLogs) { DebugReportsView(repository: reports) }
        .confirmationDialog("保存したプロフィールを削除しますか？", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("認証して削除", role: .destructive) { model.delete() }
        }
        .onChange(of: scenePhase) { _, phase in if phase == .background { model.lock() } }
        .onDisappear { model.lock() }
    }

}
