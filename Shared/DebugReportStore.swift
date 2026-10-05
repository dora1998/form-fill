import Foundation

struct DebugReportStore {
    static let groupID = "group.dev.formfill.app"
    static let maximumBytes = 20 * 1024 * 1024
    let directory: URL

    enum StoreError: Error { case unavailable, invalidReport, tooLarge }

    static func shared() throws -> DebugReportStore {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID) else {
            throw StoreError.unavailable
        }
        return DebugReportStore(directory: container.appendingPathComponent("DebugReports", isDirectory: true))
    }

    func save(_ json: String, now: Date = Date()) throws -> URL {
        let data = Data(json.utf8)
        guard data.count <= Self.maximumBytes else { throw StoreError.tooLarge }
        guard let report = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              report["schemaVersion"] as? Int == 1,
              report["product"] as? String == "Form Fill developer diagnostics" else {
            throw StoreError.invalidReport
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        var folder = directory
        var attributes = URLResourceValues()
        attributes.isExcludedFromBackup = true
        try folder.setResourceValues(attributes)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let timestamp = formatter.string(from: now).replacingOccurrences(of: ":", with: "-")
        let domain = Self.domain(from: report["currentPageURL"] as? String)
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

    func reports() throws -> [URL] {
        guard FileManager.default.fileExists(atPath: directory.path) else { return [] }
        return try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.isRegularFileKey])
            .filter { $0.pathExtension == "json" && (try? $0.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true }
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
    }
}
