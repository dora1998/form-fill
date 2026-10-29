import FormFillCore
import Foundation

/// Application-facing report access; filesystem details stay in the adapter.
public struct ReportRepository {
    public var list: () async throws -> [URL]
    public var read: (URL) async throws -> Data
    public var delete: ([URL]) async throws -> Void
    public init(list: @escaping () async throws -> [URL], read: @escaping (URL) async throws -> Data,
                delete: @escaping ([URL]) async throws -> Void) {
        self.list = list
        self.read = read
        self.delete = delete
    }
}
