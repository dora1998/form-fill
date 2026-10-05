import Foundation

@main
struct DebugReportStoreTests {
    static func main() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = DebugReportStore(directory: directory)
        let empty = try store.reports()
        assert(empty.isEmpty)
        let raw = String(repeating: "住所・モデル応答🔎", count: 100_000)
        let data = try JSONSerialization.data(withJSONObject: ["schemaVersion": 1,
            "product": "Form Fill developer diagnostics", "raw": raw,
            "currentPageURL": "https://user:password@forms.example.test:8443/address?token=private#fragment"])
        let json = String(decoding: data, as: UTF8.self)
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let first = try store.save(json, now: now)
        let second = try store.save(json, now: now)
        assert(first != second)
        assert(first.lastPathComponent == "form-fill-developer-2023-11-14T22-13-20.000Z-forms.example.test.json")
        assert(second.lastPathComponent == "form-fill-developer-2023-11-14T22-13-20.000Z-forms.example.test-1.json")
        for name in [first.lastPathComponent, second.lastPathComponent] {
            assert(!name.contains("password") && !name.contains("token") && !name.contains("8443"))
        }
        let saved = try Data(contentsOf: first)
        assert(saved == data)
        let reports = try store.reports()
        assert(reports.count == 2)
        #if os(iOS)
        let attributes = try directory.resourceValues(forKeys: [.isExcludedFromBackupKey])
        assert(attributes.isExcludedFromBackup == true)
        #endif
        for invalid in ["not json", "{}", "[]", "{\"schemaVersion\":1,\"product\":\"other\"}"] {
            do { _ = try store.save(invalid); assertionFailure("invalid report accepted") } catch {}
        }
        do {
            _ = try store.save(String(repeating: "あ", count: DebugReportStore.maximumBytes / 3 + 1))
            assertionFailure("oversized report accepted")
        } catch DebugReportStore.StoreError.tooLarge {}
        try FileManager.default.removeItem(at: first)
        let remaining = try store.reports()
        assert(remaining.count == 1 && remaining[0].lastPathComponent == second.lastPathComponent)
        let remainingData = try Data(contentsOf: remaining[0])
        assert(remainingData == data)
        for url in [nil, "not a URL", "file:///private/form", "https://example.test/../../outside"] as [String?] {
            var report: [String: Any] = ["schemaVersion": 1, "product": "Form Fill developer diagnostics"]
            report["currentPageURL"] = url
            let encoded = try JSONSerialization.data(withJSONObject: report)
            let savedURL = try store.save(String(decoding: encoded, as: UTF8.self), now: now)
            assert(savedURL.lastPathComponent.contains(url?.hasPrefix("https:") == true ? "example.test" : "unknown-site"))
            assert(savedURL.deletingLastPathComponent().standardizedFileURL == directory.standardizedFileURL)
        }
        print("Debug report storage tests passed")
    }
}
