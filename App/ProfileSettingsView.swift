import SwiftUI

struct ProfileSettingsView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var draft = Profile()
    @State private var original: Profile?
    @State private var unlocked = false
    @State private var busy = false
    @State private var generation = UUID()
    @State private var status = ""
    @State private var confirmDelete = false
    @State private var showLegacyLogs = false

    var body: some View {
        Form {
            Section {
                Label("端末内のプロフィール", systemImage: "lock.shield")
                    .font(.headline)
                Text("姓名・住所はこの端末にのみ保存します。機種変更や端末パスコードの解除・リセット後は再登録が必要です。")
                Text("Face IDまたは端末パスコードで保護します。端末パスコードを知る人も解除できます。")
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if unlocked {
                Section("姓名") {
                    TextField("姓", text: $draft.family)
                    TextField("名", text: $draft.given)
                    TextField("セイ", text: $draft.familyKana)
                    TextField("メイ", text: $draft.givenKana)
                }
                Section("住所") {
                    TextField("郵便番号（半角7桁）", text: $draft.postal).keyboardType(.numberPad)
                    Picker("都道府県", selection: $draft.prefecture) {
                        ForEach(Profile.prefectures, id: \.self) { Text($0).tag($0) }
                    }
                    TextField("市区町村", text: $draft.municipality)
                    TextField("町名・町域", text: $draft.locality)
                    TextField("丁目・番地・号", text: $draft.street)
                    TextField("建物名・部屋番号（任意）", text: $draft.building)
                }
                .autocorrectionDisabled()
                Section {
                    Button("認証して保存する") { save() }.disabled(busy)
                    Button("保存せずにロック") { lock() }.disabled(busy)
                }
                Section("開発用の詳細ログ") {
                    Text("Safariから詳細ログを保存できます。登録プロフィールは保存時にマスキングしますが、他の入力値やページ内の情報は残ります。共有前に確認してください。")
                    Button("保存したデバッグログ") { showLegacyLogs = true }
                }
            } else {
                Section {
                    Button("認証して登録・編集する") { open() }.disabled(busy)
                    Text("登録した姓名・住所はモデルに渡しません。SafariのForm Fillから解析・認証・確認して入力できます。")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            if !status.isEmpty { Section { Text(status).font(.footnote).accessibilityAddTraits(.updatesFrequently) } }
            if busy { ProgressView("処理中…") }
            Section {
                Button("保存したプロフィールを削除", role: .destructive) { confirmDelete = true }.disabled(busy)
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
        .navigationDestination(isPresented: $showLegacyLogs) { DebugReportsView() }
        .confirmationDialog("保存したプロフィールを削除しますか？", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("認証して削除", role: .destructive) { delete() }
        }
        .onChange(of: scenePhase) { _, phase in if phase == .background { lock() } }
        .onDisappear { lock() }
    }

    private func lock() {
        generation = UUID()
        unlocked = false
        draft = Profile()
        original = nil
        status = ""
    }

    private func open() {
        busy = true
        status = ""
        let token = generation
        Task { @MainActor in
            defer { busy = false }
            do {
                let profile = try await ProfileRepository.openForEditing()
                guard generation == token else { return }
                original = profile
                draft = profile ?? Profile()
                unlocked = true
            } catch {
                guard generation == token else { return }
                status = (error as? ProfileError)?.localizedDescription ?? "開けませんでした。再試行してください。"
            }
        }
    }

    private func save() {
        let candidate = draft
        let expected = original
        busy = true
        status = ""
        let token = generation
        Task { @MainActor in
            defer { busy = false }
            do {
                _ = try await ProfileRepository.save(candidate, expected: expected)
                guard generation == token else { return }
                lock()
                status = "保存しました。SafariのForm Fillから利用できます。"
            } catch {
                guard generation == token else { return }
                status = (error as? ProfileError)?.localizedDescription ?? "保存できませんでした。再試行してください。"
            }
        }
    }

    private func delete() {
        lock()
        busy = true
        let token = generation
        Task { @MainActor in
            defer { busy = false }
            do {
                try await ProfileRepository.delete()
                guard generation == token else { return }
                status = "プロフィールを削除しました。"
            } catch {
                guard generation == token else { return }
                status = (error as? ProfileError)?.localizedDescription ?? "削除できませんでした。再試行してください。"
            }
        }
    }
}

#Preview { NavigationStack { ProfileSettingsView() } }
