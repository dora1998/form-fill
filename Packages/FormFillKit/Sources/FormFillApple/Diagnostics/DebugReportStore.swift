import FormFillCore
import FormFillApplication
import Foundation

public struct DebugReportStore {
    public static let groupID = "group.dev.formfill.app"
    public static let maximumBytes = DeveloperReport.maximumBytes
    public let directory: URL

    public init(directory: URL) { self.directory = directory }

    public enum StoreError: Error { case unavailable, invalidLocation }

    public static func shared() throws -> DebugReportStore {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID) else {
            throw StoreError.unavailable
        }
        return DebugReportStore(directory: container.appendingPathComponent("DebugReports", isDirectory: true))
    }

    public func save(_ report: RedactedDeveloperReport, now: Date = Date()) throws -> URL {
        let data = Data(report.json.utf8)
        // Preserve the storage boundary's size check independently of the producer.
        guard data.count <= Self.maximumBytes else { throw DeveloperReportError.tooLarge }
        let envelope = try DeveloperReport(json: report.json)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var folder = directory
        var attributes = URLResourceValues()
        attributes.isExcludedFromBackup = true
        try folder.setResourceValues(attributes)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let timestamp = formatter.string(from: now).replacingOccurrences(of: ":", with: "-")
        let domain = Self.domain(from: envelope.currentPageURL)
        let basename = "form-fill-developer-\(timestamp)-\(domain)"
        // Publish only complete files. A temporary UUID never appears in the log list.
        let temporary = directory.appendingPathComponent(".\(UUID().uuidString).tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        #if os(iOS)
        try data.write(to: temporary, options: [.atomic, .completeFileProtection])
        #else
        try data.write(to: temporary, options: .atomic)
        #endif
        var suffix = 0
        while true {
            let filename = basename + (suffix == 0 ? "" : "-\(suffix)") + ".json"
            let url = directory.appendingPathComponent(filename)
            do {
                try FileManager.default.moveItem(at: temporary, to: url)
                return url
            } catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileWriteFileExistsError {
                suffix += 1
            }
        }
    }

    private static func domain(from value: String?) -> String {
        guard let value, let url = URL(string: value),
              ["http", "https"].contains(url.scheme?.lowercased() ?? ""), let host = url.host else {
            return "unknown-site"
        }
        let safe = host.lowercased().replacingOccurrences(of: "[^a-z0-9.-]", with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: ".-"))
        return safe.isEmpty ? "unknown-site" : String(safe.prefix(120))
    }

    public func reports() throws -> [URL] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey])
            .filter { $0.pathExtension == "json" && (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
    }
    public func read(_ url: URL) throws -> Data {
        try validateLocation(url)
        return try Data(contentsOf: url)
    }

    public func delete(_ urls: [URL]) throws {
        for url in urls { try validateLocation(url) }
        for url in urls { try FileManager.default.removeItem(at: url) }
    }

    private func validateLocation(_ url: URL) throws {
        guard url.isFileURL, url.pathExtension == "json",
              url.standardizedFileURL.deletingLastPathComponent() == directory.standardizedFileURL else {
            throw StoreError.invalidLocation
        }
    }

}
