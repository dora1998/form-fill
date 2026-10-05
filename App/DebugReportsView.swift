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
                Text("Safari拡張の「開発用の詳細情報」から「開発用データをアプリに保存」を押すと、ここにJSONファイルが追加されます。")
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
                        Button(role: .destructive) { delete([url]) } label: {
                            Label("削除", systemImage: "trash")
                        }
                        .buttonStyle(.bordered)
                    }
                }
            }
            .onDelete { offsets in delete(offsets.map { reports[$0] }) }
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

    private func delete(_ urls: [URL]) {
        do {
            for url in urls { try FileManager.default.removeItem(at: url) }
            refresh()
        } catch { message = "ログを削除できませんでした。「更新」して再試行してください。" }
    }
}
