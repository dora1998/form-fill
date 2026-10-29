import FormFillCore
import FormFillApplication
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
    @State private var model: DebugReportsModel
    @State private var document: DebugReportDocument?
    @State private var filename = "form-fill-developer"
    @State private var exporting = false

    init(repository: ReportRepository) {
        _model = State(initialValue: DebugReportsModel(repository: repository))
    }

    var body: some View {
        List {
            Section {
                Text("詳細ログにはDOM・解析過程・入力前後の値が含まれます。新規保存時は登録プロフィールをマスキングします。他の個人情報や過去のログは共有前に確認してください。左にスワイプして削除できます。")
                Text("個人情報や認証トークンが含まれ得ます。共有前に内容を確認してください。保存した記録は削除するまで端末内に残ります。")
            }
            if let message = model.message { Text(message) }
            if model.reports.isEmpty {
                Text("保存したデバッグログはありません。")
            }
            ForEach(model.reports, id: \.self) { url in
                VStack(alignment: .leading, spacing: 8) {
                    Text(url.lastPathComponent).font(.caption).textSelection(.enabled)
                    HStack {
                        Button("ファイルに保存") { Task { await export(url) } }
                            .buttonStyle(.bordered)
                            .disabled(model.busy)
                        ShareLink(item: url) { Label("共有", systemImage: "square.and.arrow.up") }
                            .buttonStyle(.bordered)
                    }
                }
            }
            .onDelete(perform: delete)
            .deleteDisabled(model.busy)
        }
        .navigationTitle("デバッグログ")
        .toolbar { Button("更新", systemImage: "arrow.clockwise") { Task { await model.refresh() } } }
        .task { await model.refresh() }
        .onChange(of: scenePhase) { _, phase in if phase == .active { Task { await model.refresh() } } }
        .fileExporter(isPresented: $exporting, document: document, contentType: .json, defaultFilename: filename) { result in
            if case .failure = result { model.message = "ファイルを保存できませんでした。再試行してください。" }
        }
    }

    private func export(_ url: URL) async {
        guard let data = await model.export(url) else { return }
        document = DebugReportDocument(data: data)
        filename = url.deletingPathExtension().lastPathComponent
        exporting = true
    }

    private func delete(_ offsets: IndexSet) {
        let urls = offsets.compactMap { model.reports.indices.contains($0) ? model.reports[$0] : nil }
        Task { await model.delete(urls) }
    }
}
