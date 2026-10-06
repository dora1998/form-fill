import SwiftUI
import UniformTypeIdentifiers

private struct DebugReportDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data
    init(data: Data) { self.data = data }
    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }
    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

struct DebugReportsView: View {
    @Environment(\.scenePhase) private var scenePhase
    @State private var reports: [URL] = []
    @State private var message: String?
    @State private var document: DebugReportDocument?
    @State private var filename = "form-fill-developer"
    @State private var exporting = false

    var body: some View {
        List {
            Section {
                Text("旧バージョンで保存した詳細ログです。現在のバージョンは新しい詳細ログを収録しません。不要なログは左にスワイプして削除できます。")
                Text("個人情報や認証トークンが含まれ得ます。共有前に内容を確認してください。保存した記録は削除するまで端末内に残ります。")
            }
            if let message { Text(message) }
            if reports.isEmpty {
                Text("保存したデバッグログはありません。")
            }
            ForEach(reports, id: \.self) { url in
                VStack(alignment: .leading, spacing: 8) {
                    Text(url.lastPathComponent).font(.caption).textSelection(.enabled)
                    HStack {
                        Button("ファイルに保存") { export(url) }
                            .buttonStyle(.bordered)
                        ShareLink(item: url) { Label("共有", systemImage: "square.and.arrow.up") }
                            .buttonStyle(.bordered)
                    }
                }
            }
            .onDelete(perform: delete)
        }
        .navigationTitle("デバッグログ")
        .toolbar { Button("更新", systemImage: "arrow.clockwise") { refresh() } }
        .onAppear(perform: refresh)
        .onChange(of: scenePhase) { _, phase in if phase == .active { refresh() } }
        .fileExporter(isPresented: $exporting, document: document, contentType: .json, defaultFilename: filename) { result in
            if case .failure = result { message = "ファイルを保存できませんでした。再試行してください。" }
        }
    }

    private func refresh() {
        do { reports = try DebugReportStore.shared().reports(); message = nil }
        catch { message = "ログを読み込めませんでした。アプリと拡張のApp Groups設定を確認してください。" }
    }

    private func export(_ url: URL) {
        do {
            document = DebugReportDocument(data: try Data(contentsOf: url))
            filename = url.deletingPathExtension().lastPathComponent
            exporting = true
        } catch { message = "ログを読み込めませんでした。再試行してください。" }
    }

    private func delete(_ offsets: IndexSet) {
        do {
            for index in offsets { try FileManager.default.removeItem(at: reports[index]) }
            refresh()
        } catch { message = "ログを削除できませんでした。「更新」して再試行してください。" }
    }
}
