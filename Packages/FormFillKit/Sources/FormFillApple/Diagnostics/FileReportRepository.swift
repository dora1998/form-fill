import FormFillCore
import FormFillApplication
import Foundation

/// Serializes file I/O away from UI isolation. Both App and Extension create an adapter.
public actor FileReportRepository {
    private let makeStore: () throws -> DebugReportStore

    public init(makeStore: @escaping () throws -> DebugReportStore = DebugReportStore.shared) {
        self.makeStore = makeStore
    }

    public func list() throws -> [URL] { try makeStore().reports() }
    public func read(_ url: URL) throws -> Data { try makeStore().read(url) }
    public func delete(_ urls: [URL]) throws { try makeStore().delete(urls) }
    public func save(_ report: RedactedDeveloperReport) throws { _ = try makeStore().save(report) }

    public nonisolated var client: ReportRepository {
        ReportRepository(list: { try await self.list() }, read: { try await self.read($0) },
                         delete: { try await self.delete($0) })
    }
}
