import FormFillCore
import Foundation
import Observation

@MainActor @Observable
public final class DebugReportsModel {
    public private(set) var reports: [URL] = []
    public var message: String?
    public private(set) var busy = false
    private let repository: ReportRepository
    private var generation = UUID()

    public init(repository: ReportRepository) { self.repository = repository }

    public func refresh() async {
        let token = UUID()
        generation = token
        do {
            let result = try await repository.list()
            guard generation == token else { return }
            reports = result
            message = nil
        } catch {
            guard generation == token else { return }
            message = "ログを読み込めませんでした。アプリと拡張のApp Groups設定を確認してください。"
        }
    }

    public func export(_ url: URL) async -> Data? {
        guard !busy else { return nil }
        busy = true
        defer { busy = false }
        do { return try await repository.read(url) }
        catch { message = "ログを読み込めませんでした。再試行してください。"; return nil }
    }

    public func delete(_ urls: [URL]) async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await repository.delete(urls)
            await refresh()
        } catch {
            // A multi-file deletion can partially succeed. Refresh the list either way.
            await refresh()
            message = "ログを削除できませんでした。「更新」して再試行してください。"
        }
    }
}
