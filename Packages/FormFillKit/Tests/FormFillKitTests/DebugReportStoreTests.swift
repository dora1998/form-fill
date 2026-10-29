import XCTest
import FormFillCore
import FormFillApplication
import FormFillApple
import Foundation

final class DebugReportStoreTests: XCTestCase {
    func testRegression() throws {
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
        let report = try DeveloperReportRedactor.redact(json, profile: nil)
        let expectedData = Data(report.json.utf8)
        let now = Date(timeIntervalSince1970: 1_700_000_000)
        let first = try store.save(report, now: now)
        let second = try store.save(report, now: now)
        assert(first != second)
        assert(first.lastPathComponent == "form-fill-developer-2023-11-14T22-13-20.000Z-forms.example.test.json")
        assert(second.lastPathComponent == "form-fill-developer-2023-11-14T22-13-20.000Z-forms.example.test-1.json")
        for name in [first.lastPathComponent, second.lastPathComponent] {
            assert(!name.contains("password") && !name.contains("token") && !name.contains("8443"))
        }
        let saved = try store.read(first)
        assert(saved == expectedData)
        let reports = try store.reports()
        assert(reports.count == 2)
        #if os(iOS)
        let attributes = try directory.resourceValues(forKeys: [.isExcludedFromBackupKey])
        assert(attributes.isExcludedFromBackup == true)
        #endif
        for invalid in ["not json", "{}", "[]", "{\"schemaVersion\":1,\"product\":\"other\"}"] {
            do { _ = try DeveloperReport(json: invalid); assertionFailure("invalid report accepted") } catch {}
        }
        do {
            _ = try DeveloperReport(json: String(repeating: "あ", count: DeveloperReport.maximumBytes / 3 + 1))
            assertionFailure("oversized report accepted")
        } catch DeveloperReportError.tooLarge {}
        try store.delete([first])
        let remaining = try store.reports()
        assert(remaining.count == 1 && remaining[0].lastPathComponent == second.lastPathComponent)
        let remainingData = try store.read(remaining[0])
        assert(remainingData == expectedData)
        for url in [nil, "not a URL", "file:///private/form", "https://example.test/../../outside"] as [String?] {
            var report: [String: Any] = ["schemaVersion": 1, "product": "Form Fill developer diagnostics"]
            report["currentPageURL"] = url
            let encoded = try JSONSerialization.data(withJSONObject: report)
            let savedURL = try store.save(DeveloperReportRedactor.redact(String(decoding: encoded, as: UTF8.self), profile: nil), now: now)
            assert(savedURL.lastPathComponent.contains(url?.hasPrefix("https:") == true ? "example.test" : "unknown-site"))
            assert(savedURL.deletingLastPathComponent().standardizedFileURL == directory.standardizedFileURL)
        }
        let outside = directory.deletingLastPathComponent().appendingPathComponent("outside.json")
        do { _ = try store.read(outside); preconditionFailure("outside read accepted") } catch DebugReportStore.StoreError.invalidLocation {}
        do { try store.delete([outside]); preconditionFailure("outside delete accepted") } catch DebugReportStore.StoreError.invalidLocation {}
        print("Debug report storage tests passed")
    }
}
